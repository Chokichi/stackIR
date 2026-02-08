# Sample Spectra

Add `.jdx`, `.jcamp`, or `.dx` spectrum files to this folder. They will be included in the sample library when you run:

```bash
npm run generate:samples
```

or when you build:

```bash
npm run build
```

Metadata (compound name, CAS number) is extracted from the file headers when possible, or derived from the filename.
