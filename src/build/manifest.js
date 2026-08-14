export const createManifest = (pages) => Object.fromEntries(pages.map((page) => [page.outputPath, page.dependencies]));
