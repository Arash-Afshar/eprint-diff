# ePrint Revision Diff Viewer

When you go to https://eprint.iacr.org/archive/versions/YEAR/ID, a pop-up appears at top right and let's you choose two revisions.
Once you choose the revisions and click on compare PDFs, it generates a diff and downloads the diff pdf.

## Building

The extension uses npm to manage PDF library dependencies. To build the extension:

```bash
make package
```

This will:
1. Install npm dependencies (`pdfjs-dist` and `pdf-lib`)
2. Copy the required minified files to the extension directory
3. Package everything into `eprintdiff-extension.zip`

The PDF libraries are automatically downloaded from npm during the build process, so you don't need to manually include them. The `make package` command handles everything.

## Development

To install dependencies manually:

```bash
npm install
```

The `postinstall` script will automatically copy the required PDF library files to the extension directory.

https://github.com/user-attachments/assets/39f6d3b8-d262-49b2-b20b-90af8489499b


