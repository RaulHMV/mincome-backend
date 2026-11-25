# `sam build` llama a este target (template.yaml, BuildMethod: makefile) con
# ARTIFACTS_DIR, la carpeta que se sube a Lambda. Necesita `npm ci` antes.
# Solo deja lambda.js, su source map y las licencias: ver
# scripts/bundle-lambda.mjs.
build-BackendFunction:
	npm run build
	node scripts/bundle-lambda.mjs "$(ARTIFACTS_DIR)"
