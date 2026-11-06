"""Pure image planning and receipt validation; no originals or AWS required."""
import json
import re
from pathlib import Path
from prepare_images import ROOT, RENDERER, sha256, write_json

IMMUTABLE = 'public, max-age=31536000, immutable'

def digest(value):
    return sha256(json.dumps(value, sort_keys=True).encode())

def plan(root=ROOT):
    manifest = json.loads((root / 'images/manifest.json').read_text())
    recipes = json.loads((root / 'images/recipes.json').read_text())
    widths = recipes['widths']
    if not widths or any(type(w) is not int or w <= 0 for w in widths):
        raise ValueError('Recipe widths must be positive integers')
    if any(type(recipes.get(k)) is not int or not 1 <= recipes[k] <= 100 for k in ('quality','fullQuality')):
        raise ValueError('Invalid WebP quality')
    images, entries, ids = [], [], set()
    for source in manifest['images']:
        if not re.fullmatch(r'[a-z0-9-]+', source['id']) or source['id'] in ids:
            raise ValueError('Invalid/duplicate source ID')
        ids.add(source['id'])
        if Path(source['file']).name != source['file'] or source['file'].startswith('.') or '\\' in source['file']:
            raise ValueError('Unsafe source filename')
        if not re.fullmatch(r'[0-9a-f]{64}',source['sha256']) or any(type(source[k]) is not int or source[k] <= 0 for k in ('width','height','bytes')):
            raise ValueError('Invalid source metadata')
        variants=[]
        for width in sorted({min(w,source['width']) for w in widths}|{source['width']}):
            height=max(1,round(source['height']*width/source['width']))
            transform=dict(width=width,height=height,quality=recipes['fullQuality'] if width==source['width'] else recipes['quality'],format='webp',method=6,resample='lanczos')
            fingerprint=digest(dict(source=source['sha256'],transform=transform,renderer=RENDERER))
            key=f"variants/{fingerprint}/{source['id']}-{width}.webp"
            variant=dict(key=key,width=width,height=height)
            variants.append(variant)
            entries.append(dict(**variant,fingerprint=fingerprint,transform=transform,source=source))
        images.append(dict(id=source['id'],alt=source['alt'],variants=variants,full=variants[-1],
                           display=[v for v in variants if v['width'] in {min(w,source['width']) for w in widths}]))
    return dict(version=1,digest=digest(dict(manifest=manifest,recipes=recipes,renderer=RENDERER)),renderer=RENDERER,images=images,entries=entries)

def validate_receipt(receipt, expected, origin=None, account=None):
    if receipt.get('version')!=1 or receipt.get('planDigest')!=expected['digest']:
        raise ValueError('Missing/stale image receipt; run make images-check PROFILE=<profile>')
    if not re.fullmatch(r'https://[a-z0-9-]+\.cloudfront\.net', receipt.get('origin','')):
        raise ValueError('Receipt must use an HTTPS CloudFront origin')
    if origin and receipt['origin']!=origin or account and receipt.get('account')!=account:
        raise ValueError('Image receipt destination mismatch')
    objects=receipt.get('objects',{})
    if set(objects)!={e['key'] for e in expected['entries']}:
        raise ValueError('Incomplete image receipt')
    for entry in expected['entries']:
        obj=objects[entry['key']]
        if any(obj.get(k)!=entry[k] for k in ('width','height','fingerprint')) or not re.fullmatch(r'[0-9a-f]{64}',obj.get('sha256','')) or type(obj.get('bytes')) is not int or obj['bytes']<=0:
            raise ValueError('Invalid image receipt object')
    return receipt

def install_receipt(receipt,root=ROOT):
    expected=plan(root)
    validate_receipt(receipt,expected)
    metadata={'origin':receipt['origin'],'images':expected['images']}
    write_json(root/'web/app/generated/images.json',metadata)
    return metadata
