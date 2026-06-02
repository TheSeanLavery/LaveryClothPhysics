# Pattern Taxonomy

This taxonomy organizes garment templates by the base block they come from and the construction features that make each style unique.

## Base Blocks

Base blocks are the reusable foundations for exact cut templates.

### Skirt Block

Required measurements:

- Waist circumference
- Hip circumference
- Waist-to-hip length
- Skirt length
- Desired wearing ease

Core pieces:

- Front skirt panel
- Back skirt panel
- Waistband or facing
- Optional lining

Key markings:

- Center front and center back
- Side seams
- Waist darts
- Hip line
- Grainline parallel to center front/back
- Hem allowance

### Bodice Block

Required measurements:

- Bust, waist, and high bust
- Back waist length
- Shoulder width
- Neck width and depth
- Armscye depth
- Bust point
- Desired wearing ease

Core pieces:

- Front bodice
- Back bodice
- Optional sleeve
- Neck facing or collar

Key markings:

- Bust darts or waist darts
- Shoulder seam
- Side seam
- Armscye notches
- Center front/back
- Grainline

### Sleeve Block

Required measurements:

- Armscye length from matching bodice
- Bicep circumference
- Sleeve length
- Wrist or cuff circumference
- Cap ease

Core pieces:

- Sleeve panel
- Optional cuff
- Optional placket

Key markings:

- Sleeve cap
- Front and back sleeve notches
- Underarm seam
- Elbow line
- Grainline along sleeve length

## Skirt Categories

### Straight Skirt

A fitted skirt based directly on the skirt block. Best for validating fit, dart placement, waistband logic, and basic seam assembly.

Template pieces:

- Front skirt
- Back skirt
- Waistband or facing

Construction notes:

- Sew darts first.
- Join side seams.
- Attach waistband or facing.
- Finish closure and hem.

### Pencil Skirt

A straight skirt tapered below the hip. Needs walking ease from a back vent, kick pleat, or slit.

Template additions:

- Back vent extension or kick pleat
- Tapered side seam below hip
- Optional lining

Simulation notes:

- Add extra collision/constraint attention around the vent.
- The taper should preserve hip circumference and reduce only below the hip line.

### A-Line Skirt

A skirt widened from waist or hip to hem. It can be drafted by closing darts and opening volume at the hem, or by adding controlled side flare.

Template additions:

- Flared side seams
- Redrawn hem curve
- Optional yoke replacing waist darts

Simulation notes:

- Volume should be distributed evenly when possible; too much side-only flare creates a flat triangular silhouette.

### Circle And Half-Circle Skirts

Circular skirts are radial templates based on waist radius and skirt length.

Template pieces:

- Full circle, half circle, or quarter circle panel
- Waistband

Key metadata:

- Waist radius
- Hem radius
- Bias regions
- Cut-on-fold lines

Simulation notes:

- Bias stretch and drape matter more than dart shaping.
- Hem curves require many segments for smooth cloth motion.

### Gathered Skirt

A rectangular or lightly shaped skirt where excess width is gathered into the waistband.

Template pieces:

- One or more rectangular panels
- Waistband

Key metadata:

- Gather ratio, commonly 1.5x to 3x waist depending on fabric and fullness
- Gather start and stop notches
- Center and side matching points

### Pleated Skirt

A skirt where extra fabric is folded into repeated pleats before attaching to a waistband.

Pleat types:

- Knife pleats: all folds face one direction.
- Box pleats: paired folds meet at the center.
- Inverted box pleats: paired folds turn away from the center.
- Accordion pleats: narrow repeated folds across the full length.
- Sunburst pleats: pleats radiate from waist to hem.

Template metadata:

- Finished waist length
- Total flat fabric width
- Pleat count
- Pleat depth
- Fold lines
- Placement lines
- Direction arrows
- Press lines
- Stay-stitch line at waist

Construction notes:

- Mark pleat fold and placement lines before removing the pattern.
- Fold, press, and baste pleats at the waist before waistband assembly.
- For exact simulation, fold lines should be represented separately from seam lines.

### Paneled Or Gored Skirt

A skirt made from repeated vertical panels.

Template pieces:

- 4, 6, 8, or more gores
- Optional yoke
- Waistband or facing

Simulation notes:

- Useful for procedural generation because panels can be mirrored and repeated.
- Edge IDs should preserve panel order around the body.

## Dress Categories

### Sheath Dress

A close-fitting dress built by extending bodice and skirt blocks into a continuous shape.

Template pieces:

- Front dress
- Back dress
- Neck facing
- Armhole facing or sleeves
- Optional lining

Construction notes:

- Darts and shaping define fit.
- Back zipper or side zipper is common.

### Shift Dress

A looser, straighter dress with less waist shaping.

Template pieces:

- Front dress
- Back dress
- Neck/armhole facings
- Optional sleeve

Simulation notes:

- Good first dress style because it has fewer fitted constraints and simpler assembly.

### Fit-And-Flare Dress

A fitted bodice attached to a flared, gathered, pleated, or circle skirt.

Template pieces:

- Front bodice
- Back bodice
- Skirt panels
- Waist seam
- Optional sleeve

Construction notes:

- Construct bodice and skirt separately.
- Join at waist seam after darts, pleats, or gathers are prepared.

### Wrap Dress

A dress with overlapping front panels tied or fastened at the waist.

Template additions:

- Left and right wrap fronts
- Tie extensions or belt
- Neckline binding/facing

Simulation notes:

- Overlap behavior, ties, and closures should be represented explicitly.

### Shirt Dress

A dress built from shirt construction with collar, placket, sleeves, cuffs, and often a waist seam.

Template pieces:

- Front placket panels
- Back bodice
- Collar and collar stand
- Sleeve and cuff
- Skirt panels

Construction notes:

- More complex because order of operations matters: placket, shoulder, collar, sleeves, side seams, cuffs, hem.

## Finishing Pieces

Finishing pieces should be first-class templates, not afterthoughts.

- Waistbands: straight, contoured, elastic casing, fold-over.
- Facings: neckline, armhole, waist, front edge.
- Linings: duplicate or simplified interior pieces.
- Pockets: inseam, patch, welt, slash.
- Closures: zipper extension, button placket, hooks, ties, snaps.
- Hem treatments: turned hem, blind hem, rolled hem, bias-bound hem.
