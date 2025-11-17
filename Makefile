.PHONY: package clean check-size list-files install

# Install npm dependencies (postinstall script automatically copies required files)
install:
	@echo "Installing npm dependencies..."
	@npm install
	@echo "? Dependencies ready"

# Package the extension for Chrome Web Store submission
package: install
	@echo "Packaging extension for Chrome Web Store..."
	@zip -r eprintdiff-extension.zip \
		content.js \
		icon16.png \
		icon48.png \
		icon128.png \
		LICENSE \
		manifest.json \
		package.json \
		package-lock.json \
		pdf.min.mjs \
		pdf.worker.min.mjs \
		pdf-lib.min.js \
		privacy.md \
		README.md \
		styles.css \
		-x "*.git*" "*.zip" "Makefile" "*.pdf" "test-*" "node_modules"
	@echo "Created eprintdiff-extension.zip"
	@echo "Ready for Chrome Web Store upload"

# Clean up generated files
clean:
	@echo "Cleaning up..."
	@rm -f *.zip
	@rm -f *.min.js
	@rm -f *.min.mjs
	@rm -rf node_modules
	@echo "Cleaned up"

# Show file sizes (useful for checking if under 10MB limit)
check-size:
	@echo "Checking file sizes..."
	@du -h eprintdiff-extension.zip 2>/dev/null || echo "Package not created yet. Run 'make package' first."

# List files that will be included
list-files: install
	@echo "Files to be included in package:"
	@ls -lh manifest.json content.js styles.css pdf.min.js pdf.worker.min.js pdf-lib.min.js icon16.png icon48.png icon128.png 2>/dev/null || echo "Some files missing!"
	@echo ""
	@echo "Note: PDF libraries are downloaded from npm during build"
