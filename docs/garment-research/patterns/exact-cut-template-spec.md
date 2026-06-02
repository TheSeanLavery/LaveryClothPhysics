# Exact Cut Template Specification

An exact cut template is a 2D garment pattern piece with enough metadata to support cutting, folding, sewing, simulation, and later editing. The template should distinguish the finished seam line from the outer cutting line.

## Template Goals

- Preserve accurate garment geometry.
- Keep construction markings machine-readable.
- Allow pattern pieces to be mirrored, repeated, scaled, and transformed.
- Let simulation attach matching seam edges without guessing.
- Support both real sewing instructions and cloth simulation constraints.

## Pattern File Shape

```json
{
  "id": "pleated-skirt-knife-basic",
  "category": "skirts/pleated",
  "units": "cm",
  "measurements": {
    "waist": 72,
    "hip": 96,
    "length": 60,
    "ease": 2
  },
  "pieces": [],
  "seams": [],
  "folds": [],
  "constructionSteps": []
}
```

## Piece Metadata

Each piece should carry:

- `id`: stable machine name, such as `front_skirt_panel`.
- `label`: human name printed on the template.
- `quantity`: number of pieces to cut.
- `mirror`: whether the piece should be mirrored for left/right sides.
- `cutOnFold`: whether an edge lies on the fabric fold.
- `fabricLayer`: shell, lining, interfacing, facing, trim, or closure.
- `grainline`: vector or named line.
- `seamAllowance`: default allowance plus per-edge overrides.
- `hemAllowance`: edge-specific hem depth.
- `vertices`: ordered 2D points for the cutting line.
- `seamLine`: ordered 2D points inside the cutting line when different.
- `notches`: alignment markers with named targets.
- `labels`: printed annotations for humans.

## Edge Metadata

Named edges are the bridge between sewing and simulation.

```json
{
  "id": "front_skirt_left_side_seam",
  "pieceId": "front_skirt",
  "kind": "side_seam",
  "fromVertex": 3,
  "toVertex": 4,
  "stitchTo": "back_skirt_right_side_seam",
  "allowanceCm": 1.5,
  "notches": ["hip", "hem"],
  "pressDirection": "back"
}
```

Common edge kinds:

- Center front
- Center back
- Side seam
- Shoulder seam
- Armscye
- Sleeve cap
- Waist seam
- Hem
- Neckline
- Opening
- Placket
- Vent
- Pocket opening

## Marking Metadata

Standard markings:

- `grainline`: arrow used to align the piece with the fabric selvedge.
- `notch`: matching point for assembly.
- `dart`: fold-and-stitch shaping wedge.
- `pleatFold`: line that folds.
- `pleatPlacement`: line the fold meets.
- `gatherRange`: section where fabric is gathered.
- `buttonhole`: buttonhole position and direction.
- `button`: button position.
- `zipperStop`: zipper end marker.
- `cutOnFold`: edge that should not be cut as a separate seam.
- `lengthenShorten`: adjustment line.

## Pleat Model

Pleats need more detail than normal seams because the same cloth panel has internal folds.

```json
{
  "id": "front_knife_pleats",
  "pieceId": "front_panel",
  "type": "knife",
  "count": 12,
  "direction": "left",
  "finishedWidthCm": 36,
  "flatWidthCm": 108,
  "folds": [
    {
      "foldLine": "x=6",
      "placementLine": "x=3",
      "depthCm": 3,
      "pressTo": "left"
    }
  ],
  "basteLine": "waist_seam"
}
```

Pleat calculations:

- `flatWidth = finishedWidth + hiddenPleatTakeup`
- Knife pleat takeup is usually `2 * pleatDepth` per pleat.
- Box pleat takeup is usually `2 * pleatDepth` for each side pair, or `4 * pleatDepth` for a full box unit depending on how the unit is defined.
- Accordion pleats require alternating mountain and valley fold lines.

## Dart Model

```json
{
  "id": "front_waist_dart",
  "pieceId": "front_bodice",
  "type": "waist",
  "intakeCm": 2.5,
  "lengthCm": 11,
  "apex": [14, 18],
  "legs": [[12.75, 29], [15.25, 29]],
  "pressDirection": "center"
}
```

Darts should remain editable because many style changes are created by closing, rotating, or converting darts into pleats, gathers, seams, or flare.

## Seam Allowance Rules

Use one project default, then override where needed.

Recommended defaults:

- General seam allowance: `1.0cm` or `1.5cm`
- Neckline curves: `0.6cm` to `1.0cm`
- Armhole curves: `1.0cm`
- Hems: `2.5cm` to `5.0cm`
- Facings: match the seam they finish
- Test/muslin templates: include clear seam line and cut line

The pattern file must state whether seam allowance is included. Cutting geometry should not silently switch between finished and cut dimensions.

## Construction Step Model

```json
{
  "order": 4,
  "operation": "sew",
  "inputs": ["front_skirt_left_side_seam", "back_skirt_right_side_seam"],
  "stitchLine": "seamLine",
  "allowanceCm": 1.5,
  "press": "toward_back",
  "notes": "Match hip and hem notches before stitching."
}
```

Operation types:

- Mark
- Interface
- Fold
- Press
- Baste
- Gather
- Pleat
- Sew
- Clip
- Grade
- Understitch
- Topstitch
- Finish edge
- Hem
- Attach closure

## Simulation Export Requirements

For cloth simulation, each pattern should export:

- Panel polygon in local 2D coordinates.
- Initial 3D placement around the body.
- Named seam pairs with direction and compatible lengths.
- Internal fold constraints for pleats, darts, and pressed edges.
- Material intent: woven, knit, bias, lining, interfacing, or elastic.
- Collision priority for overlaps such as wrap fronts, vents, and pleats.

## Validation Checklist

- All pieces have units, quantity, grainline, and labels.
- Every sewable edge has an ID.
- Seam pairs have compatible lengths or declared easing/gathering.
- Pleat fold lines and placement lines are paired.
- Darts include intake, apex, and legs.
- Cutting line and stitch line are not confused.
- Center front/back and cut-on-fold edges are marked.
- Hem allowance is explicit.
- Construction order can be followed without hidden assumptions.
