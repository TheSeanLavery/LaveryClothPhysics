# Garment Construction Workflows

These workflows describe how pattern pieces should be organized and sewn together. They are intentionally written so they can become construction steps in generated templates.

## Universal Pattern Workflow

1. Draft or load base block.
2. Apply style transformation.
3. True seams and smooth curves.
4. Add seam allowance and hem allowance.
5. Add grainline, notches, darts, pleat lines, fold lines, and closure markings.
6. Cut shell fabric, lining, interfacing, and trim pieces.
7. Transfer construction markings.
8. Sew shaping first: darts, tucks, pleats, gathers, yokes.
9. Assemble major seams.
10. Attach finishing pieces.
11. Add closures.
12. Hem and press.

## Basic Skirt

Pattern pieces:

- Front skirt
- Back skirt
- Waistband or waist facing
- Optional zipper extension
- Optional lining

Construction:

1. Mark darts, hip notches, center front, center back, and side seams.
2. Sew front and back darts.
3. Press darts toward center.
4. Join side seams, leaving zipper opening if needed.
5. Install zipper or closure.
6. Attach waistband or facing.
7. Finish inner waistband/facing edge.
8. Sew hem.

Simulation mapping:

- Side seam edges become seam constraints.
- Waist edge attaches to waistband or body anchor depending on use.
- Darts can become internal fold-and-stitch constraints or pre-shaped geometry.

## Pencil Skirt

Pattern pieces:

- Front skirt
- Back skirt with vent or kick pleat
- Waistband or facing
- Optional lining

Construction:

1. Sew darts.
2. Prepare back vent or kick pleat.
3. Join center back seam to vent/zipper point.
4. Install zipper.
5. Join side seams.
6. Attach waistband or facing.
7. Hem skirt and finish vent.

Template notes:

- A narrow skirt needs walking ease.
- The vent extension should be its own marked region with fold, seam, and hem lines.

## A-Line Skirt

Pattern pieces:

- Front flared panel
- Back flared panel
- Waistband, facing, or yoke

Construction:

1. If using a yoke, assemble yoke pieces first.
2. Join side seams.
3. Attach waistband, facing, or yoke.
4. Install closure.
5. Let bias/flared areas relax if using real fabric, then level hem.
6. Sew hem.

Template notes:

- Redraw hem as a smooth curve after adding flare.
- If darts are closed into flare, remove the dart stitching operation from construction steps.

## Circle Skirt

Pattern pieces:

- Circular skirt panel or panels
- Waistband

Construction:

1. Join panel seams if not cut as one piece.
2. Stay-stitch waist edge to prevent stretching.
3. Attach waistband.
4. Install closure if not elastic.
5. Allow hem to hang before final hemming in real fabric.
6. Hem with narrow, bias-friendly method.

Template notes:

- Mark bias regions because they drape and stretch differently.
- Use high enough polygon resolution for the hem curve.

## Gathered Skirt

Pattern pieces:

- Rectangular or shaped skirt panels
- Waistband

Construction:

1. Sew side seams.
2. Sew gathering stitches along waist edge.
3. Pull gathers to match waistband length.
4. Match center and side notches.
5. Attach waistband.
6. Finish closure and hem.

Simulation mapping:

- Gathering can be represented as an edge-length mismatch where the skirt waist edge eases into a shorter waistband edge.
- Keep gather ranges named so fullness can be distributed intentionally.

## Pleated Skirt

Pattern pieces:

- Pleated front/back panel or repeated pleat panels
- Waistband
- Optional lining

Construction:

1. Mark every fold line and placement line.
2. Fold pleats in the specified direction.
3. Press pleats.
4. Baste pleats along the waist.
5. Join side seams without disturbing pleat order.
6. Attach waistband.
7. Install closure.
8. Hem after pleats are secured.

Template notes:

- Knife pleats need a direction for every fold.
- Box pleats need paired fold lines meeting at a placement line.
- Accordion pleats need alternating mountain/valley folds.
- Pleat metadata must survive export because it drives folding behavior in simulation.

## Fit-And-Flare Dress

Pattern pieces:

- Front bodice
- Back bodice
- Skirt front/back or circular skirt
- Sleeves if used
- Neck facing or lining
- Waist seam

Construction:

1. Sew bodice darts or princess seams.
2. Sew shoulder seams.
3. Finish neckline with facing, lining, collar, or binding.
4. Prepare sleeves if used.
5. Assemble skirt and prepare gathers, pleats, or flare.
6. Join bodice to skirt at waist seam.
7. Install zipper or closure.
8. Sew side seams if construction order uses flat assembly.
9. Hem skirt and sleeves.

Simulation mapping:

- The waist seam is the main join between upper and lower garment systems.
- Skirt fullness can be gathered, pleated, circular, or paneled while using the same bodice.

## Wrap Dress Or Wrap Skirt

Pattern pieces:

- Underlap panel
- Overlap panel
- Back panel
- Waist ties or belt
- Neckline/front edge facing or binding

Construction:

1. Finish front wrap edges.
2. Attach ties or belt openings.
3. Join shoulder and side seams as applicable.
4. Secure waist or side openings.
5. Hem.

Template notes:

- Overlap order matters for simulation.
- Tie anchors and pass-through openings should be explicit.

## Shirt Dress

Pattern pieces:

- Front left and right with placket
- Back bodice
- Collar and collar stand
- Sleeve
- Cuff and placket
- Skirt panels
- Optional pockets

Construction:

1. Prepare front plackets.
2. Sew shoulder seams.
3. Assemble collar and collar stand.
4. Attach collar.
5. Prepare sleeves and cuffs.
6. Set sleeves or sew flat depending on style.
7. Join side seams.
8. Attach skirt if there is a waist seam.
9. Add buttonholes and buttons.
10. Hem.

Template notes:

- Shirt dresses require more small pieces and strict construction order.
- Plackets, collars, cuffs, and buttonholes should be reusable sub-templates.

## Pattern Organization Checklist

- Group pieces by garment region: bodice, skirt, sleeve, finishing, closure, lining.
- Name all pieces with side and layer: `front_bodice_shell_left`, `back_skirt_lining_right`.
- Name all seam edges by relationship: `front_bodice_side_seam_to_back_bodice`.
- Keep mirrored pieces linked to a source piece rather than hand-copying geometry.
- Store style transformations separately from base block measurements.
- Store construction steps separately from geometry so the same geometry can be assembled differently if needed.
