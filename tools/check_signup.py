"""Generate an offline signup fixture, run browser checks, restore disabled local output."""
import os
import subprocess
from prepare_images import ROOT

def main():
    clean = {k:v for k,v in os.environ.items() if not k.startswith(('FLAT_GIRL_SIGNUP_', 'FLAT_GIRL_TURNSTILE_', 'NUXT_PUBLIC_SIGNUP_', 'NUXT_PUBLIC_TURNSTILE_'))}
    enabled = dict(clean, FLAT_GIRL_SIGNUP_ENABLED='true', FLAT_GIRL_SIGNUP_ENVIRONMENT='beta',
                   FLAT_GIRL_SIGNUP_ENDPOINT='https://signup.invalid/subscribe', FLAT_GIRL_TURNSTILE_SITE_KEY='1x00000000000000000000AA',
                   FLAT_GIRL_TEST_SIGNUP='true')
    try:
        subprocess.run(['npm','run','generate','--prefix','web'],cwd=ROOT,env=enabled,check=True)
        subprocess.run(['npm','run','test:e2e','--prefix','web'],cwd=ROOT,env=enabled,check=True)
    finally:
        subprocess.run(['npm','run','generate','--prefix','web'],cwd=ROOT,env=dict(clean,FLAT_GIRL_SIGNUP_ENABLED='false'),check=True)

if __name__=='__main__':main()
