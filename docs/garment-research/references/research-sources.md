# Research Sources

These sources were used to seed the garment template documentation. They are not copied as complete instructions; the docs summarize common patternmaking concepts that can be translated into this project's template and cloth simulation systems.

## Base Blocks And Slopers

- [How To Draft A Basic Bodice Block Pattern](https://anicka.design/how-to-draft-a-basic-bodice-block-pattern/) covers bodice block drafting, front/back bodice pieces, armscye shaping, notches, and the role of the bodice block as a reusable foundation.
- [How to Draft a Custom Bodice Block](https://stitchpaperscissors.com/custom-bodice-block/) explains close-fitting bodice slopers, wearing ease, waist shaping, and dart width distribution.
- [How To Draft A Simple Knit Bodice Block With Sleeve Professionally](https://charnold.com/knit-bodice-block-tutorial/) describes knit blocks, negative ease, and converting a bodice into T-shirt, bodycon, fit-and-flare, wrap, tank, or maxi dress designs.
- [How To Draft A Basic Bodice Block Without Darts](https://charnold.com/how-to-draft-a-basic-bodice-block-without-darts/) provides a dartless block approach and practical seam allowance examples.

## Skirt Blocks And Transformations

- [How To Draft A Basic Skirt Pattern](https://anicka.design/how-to-draft-basic-skirt-pattern/) describes the skirt block as the basis for simple, A-line, pencil, pleated, folded, flounced, and gathered skirts.
- [Drafting Instructions - Basic Skirt Foundation](https://nuriamo.com/drafting-instructions-free-skirt-pattern/) covers waist/hip drafting, dart rules, side seam checks, and basic skirt foundation logic.
- [Simple skirt pattern alterations](https://www.theshapesoffabric.com/2019/03/04/simple-skirt-pattern-alterations/) explains dart manipulation, A-line transformations, pencil skirt shaping, yokes, and panel changes.
- [Super-Elegant! Drafting a Pencil Skirt Pattern](https://korfiati.net/pencil-skirt-pattern/) includes pencil skirt tapering, vent logic, back darts, and construction notes.
- [How to draft a pencil skirt pattern](https://sewingwithnumbers.substack.com/p/how-to-draft-a-pencil-skirt-pattern) discusses adapting a woven skirt block into a waistband and kick pleat pattern.

## Pattern Markings

- [Understanding Pattern Markings](https://www.sewing.org/files/guidelines/3_110_pattern_markings_part1.pdf) describes commercial pattern symbols, piece labels, notches, cutting lines, construction markings, and layout markings.
- [Understanding Sewing Pattern Markings](https://tillyandthebuttons.com/blogs/sewing/understanding-sewing-pattern-markings) explains grainlines, darts, notches, and marking transfer methods.
- [9 Pattern Markings Sewing Beginners Need to Know](https://welikesewing.com/articles/9-pattern-markings-sewing-beginners-need-to-know/) summarizes stitching lines, grainlines, notches, darts, and fit adjustment lines.
- [How to Read Sewing Pattern Symbols](https://sewingbible.com/read-sewing-pattern-symbols-grainline-notches/) compares grainlines, notches, dart lines, seam allowances, hem allowances, and allowance conventions across pattern types.

## Research Takeaways For This Project

- Use base blocks as parametric inputs instead of hand-authoring every garment from scratch.
- Treat darts, pleats, gathers, vents, yokes, facings, waistbands, and closures as named construction features.
- Store cutting lines and stitching lines separately.
- Preserve grainline, notches, fold lines, placement lines, and press direction as template metadata.
- Represent pleats as internal fold systems, not just extra mesh width.
- Require every seam edge to have a stable ID and an optional matched edge.
- Add validation around seam length compatibility, easing, gathering, and pleat takeup.
