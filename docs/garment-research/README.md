# Garment Folding And Clothing Pattern Research

This folder collects research and implementation notes for turning realistic clothing patternmaking into simulation-ready cut templates. The goal is to describe garments as organized 2D pattern pieces with exact edges, fold lines, pleat lines, seam relationships, grainlines, notches, and construction order.

## Documentation Map

- `patterns/pattern-taxonomy.md` organizes skirts, pleated skirts, dresses, bodices, sleeves, and finishing pieces into reusable pattern categories.
- `patterns/exact-cut-template-spec.md` defines the metadata each exact cut template should carry so it can be drafted, cut, folded, sewn, and simulated consistently.
- `construction/assembly-workflows.md` describes how common garments are sewn together from pattern pieces.
- `references/research-sources.md` lists the online research sources used to seed the garment system.

## Core Idea

Realistic garment templates should be built from base blocks first, then transformed into style patterns:

1. Draft base blocks from measurements: bodice block, skirt block, sleeve block, waistband, facing, lining, and pocket pieces.
2. Transform blocks into styles: A-line, pencil, circle, gathered, pleated, wrap, paneled, fit-and-flare, shift, sheath, shirt dress, and maxi dress.
3. Add exact construction metadata: seam allowance, hem allowance, grainline, notches, darts, pleat fold lines, pleat placement, cut-on-fold markers, and stitch/fold/press instructions.
4. Export pattern pieces as simulation-ready panels with named edges and edge relationships.

## Suggested Folder Model For Generated Garments

Generated or authored garment assets can follow this structure:

```text
generated/garments/
  skirts/
    a-line/
    pencil/
    circle/
    pleated/
    gathered/
    wrap/
  dresses/
    sheath/
    shift/
    fit-and-flare/
    wrap/
    shirt-dress/
    maxi/
  blocks/
    bodice/
    skirt/
    sleeve/
    waistband/
  trims/
    facings/
    linings/
    pockets/
    closures/
```

Each generated template should include a machine-readable pattern file, a human-readable construction sheet, and optional preview geometry.
