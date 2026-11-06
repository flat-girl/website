"""npm pre-hook: local preparation or verified receipt installation."""
import argparse
import json
import os
import shutil
from prepare_images import ROOT, prepare
from image_plan import install_receipt

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    mode=os.environ.get('FLAT_GIRL_IMAGE_MODE','local')
    if mode=='local':
        prepare(check=args.check)
    elif mode=='cdn':
        receipt=json.loads((ROOT/'.deploy/images.ready.json').read_text())
        if args.check:
            from image_plan import validate_receipt,plan
            validate_receipt(receipt,plan())
        else:
            install_receipt(receipt)
            staged=ROOT/'web/public/variants'
            if staged.is_symlink(): raise ValueError('Refusing symlinked generated variants directory')
            if staged.exists(): shutil.rmtree(staged)
    else:
        raise ValueError('FLAT_GIRL_IMAGE_MODE must be local or cdn')

if __name__=='__main__':
    main()
