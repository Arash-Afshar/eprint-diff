.PHONY: package clean check-size list-files deps

# Install npm dependencies (postinstall script automatically copies required files)
deps:
	@echo "Installing npm dependencies..."
	@npm install
	@echo "? Dependencies ready"

# Package the extension for Chrome Web Store submission
package: deps
	@echo "Packaging extension for Chrome Web Store..."
	@zip -r eprintdiff-extension.zip \
		manifest.json \
		content.js \
		styles.css \
		pdf.min.js \
		pdf.worker.min.js \
		pdf-lib.min.js \
		icon16.png \
		icon48.png \
		icon128.png \
		-x "*.git*" "*.zip" "*.md" "Makefile" "*.pdf" "test-*" "node_modules" "package*.json"
	@echo "? Created eprintdiff-extension.zip"
	@echo "? Ready for Chrome Web Store upload"

# Clean up generated files
clean:
	@echo "Cleaning up..."
	@rm -f eprintdiff-extension.zip
	@rm -f pdf.min.js pdf.worker.min.js pdf-lib.min.js pdf.sandbox.min.js
	@rm -rf pdfjs-dist/ pdf-lib/
	@echo "? Cleaned up"

# Show file sizes (useful for checking if under 10MB limit)
check-size:
	@echo "Checking file sizes..."
	@du -h eprintdiff-extension.zip 2>/dev/null || echo "Package not created yet. Run 'make package' first."

# List files that will be included
list-files: deps
	@echo "Files to be included in package:"
	@ls -lh manifest.json content.js styles.css pdf.min.js pdf.worker.min.js pdf-lib.min.js icon16.png icon48.png icon128.png 2>/dev/null || echo "Some files missing!"
	@echo ""
	@echo "Note: PDF libraries are downloaded from npm during build"
