"""Private originals and immutable shared variants."""
import argparse
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from PIL import Image, ImageOps
from aws_common import AWS, AwsError, bucket, project
from image_plan import IMMUTABLE, plan, validate_receipt
from prepare_images import ROOT, sha256, source_info, write_json, save_variant

def source_key(source): return f"sources/{source['sha256']}/{source['file']}"
def checksum64(value): return base64.b64encode(bytes.fromhex(value)).decode()

def destinations(aws):
    outputs=aws.outputs('images')
    if outputs.get('SourceBucketName')!=bucket(aws.p,'sources') or outputs.get('VariantsBucketName')!=bucket(aws.p,'variants'):
        raise ValueError('Image stack outputs do not match configured buckets')
    return outputs

def restore(aws,source,name,root=ROOT):
    target=root/'images/raw'/source['file']
    if target.exists():
        if source_info(target)!={k:source[k] for k in ('sha256','bytes','width','height')}: raise ValueError(f'Preserve changed local original before restoring: {source["file"]}')
        return target,0
    target.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent) as temporary:
        downloaded=Path(temporary)/'source'
        aws.download(name,source_key(source),downloaded)
        if source_info(downloaded)!={k:source[k] for k in ('sha256','bytes','width','height')}: raise ValueError('Downloaded original checksum/dimensions differ')
        downloaded.replace(target)
    return target,1

def immutable_upload(aws,name,key,path,content_type,metadata,cache=IMMUTABLE):
    digest=sha256(path.read_bytes())
    for attempt in range(3):
        try:
            aws.upload(name,key,path,IfNoneMatch='*',ChecksumAlgorithm='SHA256',ChecksumSHA256=checksum64(digest),
                       Metadata=metadata,ContentType=content_type,CacheControl=cache,ServerSideEncryption='AES256')
            break
        except AwsError as error:
            if error.code in ('412','PreconditionFailed'): break
            if error.code not in ('409','ConditionalRequestConflict') or attempt==2: raise
    head=aws.head(name,key)
    if not head or head.get('ChecksumSHA256')!=checksum64(digest) or head['ContentLength']!=path.stat().st_size:
        raise ValueError(f'Immutable upload conflict: {key}')
    return head

def remote_variant(aws,name,entry):
    head=aws.head(name,entry['key'])
    if head is None: return None
    metadata=head.get('Metadata',{})
    digest=metadata.get('sha256','')
    if len(digest)!=64: raise ValueError(f'Variant checksum missing: {entry["key"]}')
    try: encoded=checksum64(digest)
    except ValueError: raise ValueError('Invalid variant checksum') from None
    if (head.get('ChecksumSHA256')!=encoded or head.get('ContentLength',0)<=0 or
        head.get('ContentType')!=f"image/{entry['transform']['format']}" or head.get('CacheControl')!=IMMUTABLE or
        metadata.get('fingerprint')!=entry['fingerprint'] or
        any(metadata.get(k)!=str(entry[k]) for k in ('width','height'))):
        raise ValueError(f'Remote variant conflict: {entry["key"]}')
    return dict(sha256=digest,bytes=head['ContentLength'],fingerprint=entry['fingerprint'],width=entry['width'],height=entry['height'])

def render(source,entry,path):
    with Image.open(source) as original:
        pixels=ImageOps.exif_transpose(original).convert('RGBA')
        pixels=Image.frombytes('RGBA',pixels.size,pixels.tobytes())
        path.parent.mkdir(parents=True,exist_ok=True)
        save_variant(pixels,path,entry['transform'])

def ensure(aws,check=False,dry_run=False,root=ROOT):
    expected=plan(root); outputs=destinations(aws); name=outputs['VariantsBucketName']
    objects={}; counts=dict(hits=0,downloads=0,rendered=0,uploads=0,missing=0)
    old_path=root/'images/processed/metadata.json'
    old=json.loads(old_path.read_text()) if old_path.exists() else {'images':[]}
    previous={v['key']:v for image in old['images'] for v in image['variants']}
    for entry in expected['entries']:
        obj=remote_variant(aws,name,entry)
        if obj:
            objects[entry['key']]=obj; counts['hits']+=1;continue
        counts['missing']+=1
        if dry_run: continue
        if check: raise ValueError(f'Missing variant: {entry["key"]}; run image-variants ensure')
        output=root/'images/processed'/entry['key']
        valid=output.is_file() and sha256(output.read_bytes())==previous.get(entry['key'],{}).get('sha256')
        if not valid:
            source,downloaded=restore(aws,entry['source'],outputs['SourceBucketName'],root)
            counts['downloads']+=downloaded
            render(source,entry,output); counts['rendered']+=1
        digest=sha256(output.read_bytes())
        immutable_upload(aws,name,entry['key'],output,f"image/{entry['transform']['format']}",dict(sha256=digest,fingerprint=entry['fingerprint'],width=str(entry['width']),height=str(entry['height'])))
        objects[entry['key']]=remote_variant(aws,name,entry)
        counts['uploads']+=1
    print('Images: '+', '.join(f'{v} {k}' for k,v in counts.items()))
    if dry_run: return None
    receipt=dict(version=1,account=aws.p['account'],bucket=name,distribution=outputs['DistributionId'],origin=outputs['ImageBaseUrl'],
                 planDigest=expected['digest'],renderer=expected['renderer'],verifiedAt=datetime.now(timezone.utc).isoformat(),objects=objects)
    validate_receipt(receipt,expected,outputs['ImageBaseUrl'],aws.p['account'])
    write_json(root/'.deploy/images.ready.json',receipt)
    return receipt

def main(kind):
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['import','pull'] if kind=='sources' else ['ensure','check'])
    parser.add_argument('--profile',required=True);parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    aws=AWS(args.profile,project(),read_only=args.dry_run or args.command in ('check','pull'))
    if kind=='variants': return ensure(aws,args.command=='check',args.dry_run)
    outputs=destinations(aws)
    for source in json.loads((ROOT/'images/manifest.json').read_text())['images']:
        # Pure planner also validates filenames and tracked metadata before filesystem operations.
        plan()
        if args.command=='pull':
            if args.dry_run: print(f'Would restore {source["id"]}')
            else: restore(aws,source,outputs['SourceBucketName'])
        else:
            path=ROOT/'images/raw'/source['file']
            if source_info(path)!={k:source[k] for k in ('sha256','bytes','width','height')}: raise ValueError('Original differs from tracked manifest')
            existing=aws.head(outputs['SourceBucketName'],source_key(source))
            if existing:
                if existing.get('ChecksumSHA256')!=checksum64(source['sha256']) or existing['ContentLength']!=source['bytes']: raise ValueError('Remote original conflict')
                print(f'Original verified: {source["id"]}')
            elif args.dry_run: print(f'Would import {source["id"]}')
            else:
                with Image.open(path) as image:
                    content_type = Image.MIME[image.format]
                immutable_upload(aws,outputs['SourceBucketName'],source_key(source),path,content_type,{'sha256':source['sha256']},'private, no-store')
                print(f'Original imported: {source["id"]}')

if __name__=='__main__':
    import sys
    kind=sys.argv.pop(1)
    try: main(kind)
    except (ValueError,RuntimeError,OSError) as error: sys.exit(str(error))
