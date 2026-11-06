.DEFAULT_GOAL := help

UV ?= uv
PYTHON = $(UV) run --locked --project tools python
DRY_RUN ?= 0
BOOTSTRAP ?= 0

# Quote values as shell arguments; require an explicit AWS profile/destination.
quote = '$(subst ','"'"',$(1))'
required = $(if $(strip $($(1))),$(call quote,$($(1))),$(error Set $(1); see make help))
profile = --profile $(call required,PROFILE)
site_env = --env $(call required,SITE_ENV)
dry_run = $(if $(filter 1,$(DRY_RUN)),--dry-run,$(if $(filter 0,$(DRY_RUN)),,$(error DRY_RUN must be 0 or 1)))
bootstrap = $(if $(filter 1,$(BOOTSTRAP)),--bootstrap,$(if $(filter 0,$(BOOTSTRAP)),,$(error BOOTSTRAP must be 0 or 1)))
release = $(if $(strip $(RELEASE)),--release $(call quote,$(RELEASE)))
no_dry_run = $(if $(filter 0,$(DRY_RUN)),,$(error This target does not support DRY_RUN; use cloud-diff for infrastructure previews))

.PHONY: help cloud-preflight cloud-diff cloud-deploy beta-auth beta-enabled \
        sources-import sources-pull images-ensure images-check \
        site-build site-publish site-verify site-rollback signup-secrets signup-preflight signup-status signup-enabled

help:
	@printf '%s\n' \
	  'Run from the repository root. AWS targets require PROFILE explicitly.' \
	  '' \
	  '  make cloud-preflight PROFILE=default' \
	  '  make cloud-diff PROFILE=default STACK=access' \
	  '  make cloud-deploy PROFILE=default STACK=access BOOTSTRAP=1' \
	  '  make cloud-deploy PROFILE=flat-girl STACK=certificates' \
	  '  make beta-auth PROFILE=flat-girl' \
	  '  make beta-enabled PROFILE=flat-girl ENABLED=false' \
	  '  make sources-import PROFILE=flat-girl DRY_RUN=1' \
	  '  make sources-pull PROFILE=flat-girl' \
	  '  make images-ensure PROFILE=flat-girl DRY_RUN=1' \
	  '  make images-check PROFILE=flat-girl' \
	  '  make site-build PROFILE=flat-girl-beta SITE_ENV=beta' \
	  '  make site-publish PROFILE=flat-girl-beta SITE_ENV=beta DRY_RUN=1' \
	  '  make site-verify PROFILE=flat-girl-beta SITE_ENV=beta' \
	  '  make site-rollback PROFILE=flat-girl-beta SITE_ENV=beta RELEASE=release-id' \
	  '  make signup-secrets PROFILE=flat-girl [KEY=turnstile|brevo]  (shared keys)' \
	  '  make signup-preflight PROFILE=flat-girl SITE_ENV=beta' \
	  '  make signup-status PROFILE=flat-girl SITE_ENV=beta' \
	  '  make signup-enabled PROFILE=flat-girl SITE_ENV=beta ENABLED=false DRY_RUN=1' \
	  '' \
	  'DRY_RUN=1 previews supported operations; omit it to perform them.' \
	  'site-publish and site-verify optionally accept RELEASE; rollback requires it.' \
	  'See cloud/ACCESS.md and cloud/DEPLOYMENT.md for rollout order.'

cloud-preflight:
	$(PYTHON) tools/cloud.py preflight $(profile) --read-only

cloud-diff:
	$(PYTHON) tools/cloud.py diff $(profile) --stack $(call required,STACK)

cloud-deploy:
	$(no_dry_run)$(PYTHON) tools/cloud.py deploy $(profile) --stack $(call required,STACK) $(bootstrap)

beta-auth:
	$(no_dry_run)$(PYTHON) tools/cloud.py auth set $(profile)

beta-enabled:
	$(no_dry_run)$(PYTHON) tools/cloud.py beta-enabled $(profile) --value $(call required,ENABLED)

sources-import:
	$(PYTHON) tools/remote_images.py sources import $(profile) $(dry_run)

sources-pull:
	$(PYTHON) tools/remote_images.py sources pull $(profile) $(dry_run)

images-ensure:
	$(PYTHON) tools/remote_images.py variants ensure $(profile) $(dry_run)

images-check:
	$(PYTHON) tools/remote_images.py variants check $(profile)

site-build:
	$(PYTHON) tools/deploy_site.py build $(profile) $(site_env)

site-publish:
	$(PYTHON) tools/deploy_site.py publish $(profile) $(site_env) $(release) $(dry_run)

site-verify:
	$(PYTHON) tools/deploy_site.py verify $(profile) $(site_env) $(release)

site-rollback:
	$(PYTHON) tools/deploy_site.py rollback $(profile) $(site_env) --release $(call required,RELEASE) $(dry_run)

signup-secrets:
	$(no_dry_run)$(PYTHON) tools/signup.py secrets $(profile) $(if $(strip $(KEY)),--key $(call quote,$(KEY)))

signup-preflight:
	$(PYTHON) tools/signup.py preflight $(profile) $(site_env)

signup-status:
	$(PYTHON) tools/signup.py status $(profile) $(site_env)

signup-enabled:
	$(PYTHON) tools/signup.py enabled $(profile) $(site_env) --value $(call required,ENABLED) $(dry_run)
