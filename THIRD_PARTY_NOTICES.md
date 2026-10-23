# Third-party notices

OpenRigor's original source is licensed under MIT. The web application, local API, and development tools also include or depend on the following projects under their own terms:

- Vercel AI Elements component source: Apache License 2.0, <https://github.com/vercel/ai-elements>.
- Streamdown: Apache License 2.0, <https://github.com/vercel/streamdown>.
- DOMPurify (`dompurify` 3.4.17), used for static HTML preview sanitization: dual licensed under MPL 2.0 or Apache License 2.0 (`MPL-2.0 OR Apache-2.0`), <https://github.com/cure53/DOMPurify>. The package includes both `LICENSE` and `LICENSE-MPL`.
- Mozilla Readability (`@mozilla/readability` 0.6.0), used by the public-page text reader: Apache License 2.0, copyright (c) 2010 Arc90 Inc, <https://github.com/mozilla/readability>.
- linkedom (`linkedom` 0.18.13), used for server-side parsing in the public-page text reader: ISC License, copyright (c) 2021 Andrea Giammarchi, @WebReflection, <https://github.com/WebReflection/linkedom>.
- PDF.js (`pdfjs-dist`) and its bundled parser worker: Apache License 2.0, <https://github.com/mozilla/pdf.js>. Bundled Adobe CMaps, Foxit and Liberation fonts, and JBIG2/OpenJPEG image codecs retain their upstream licenses and copyright notices in [`apps/web/public/licenses/pdfjs/`](apps/web/public/licenses/pdfjs/), shipped with the web application under `/licenses/pdfjs/`.
- shadcn component source and CLI: MIT License, <https://github.com/shadcn-ui/ui>.
- React Resizable Panels: MIT License, <https://github.com/bvaughn/react-resizable-panels>.
- Radix UI and supporting primitives: MIT License, <https://github.com/radix-ui/primitives>.
- GSAP runtime: GreenSock standard no-charge license, <https://gsap.com/standard-license/>; GSAP is not relicensed as MIT by this repository.
- jsdom (`jsdom` 30.1.3), used only by development tests of HTML preview sanitization: MIT License, <https://github.com/jsdom/jsdom>.

AICSS source is not vendored. Its public examples are used only as product-design reference unless a future contribution documents explicit redistribution permission.
