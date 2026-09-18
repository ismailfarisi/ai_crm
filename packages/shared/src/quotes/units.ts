/**
 * Units a line can be quoted, ordered or stocked in.
 *
 * The quote editor used to offer a fixed list of eight — Units, Hours, Days,
 * Licenses, Months, Packages, Services, Items — which is a software-services
 * list, on a product sold to made-to-order manufacturers. There was no kg, no
 * m², no sheet, roll, pallet or thousand, and no way to add one, so 500 boxes
 * had to be quoted in "Units".
 *
 * Grouped for the picker. Nothing here is a closed set: `uom` is a free string
 * on the line, the input is a combobox, and a trade with a unit of its own can
 * type it. These are the suggestions, not the permitted values.
 */
export interface UnitGroup {
  label: string;
  units: string[];
}

export const UNIT_GROUPS: readonly UnitGroup[] = [
  {
    label: 'Count',
    units: ['Units', 'Items', 'Pieces', 'Sets', 'Pairs', 'Thousand'],
  },
  {
    label: 'Weight',
    units: ['kg', 'g', 'tonne', 'lb', 'oz'],
  },
  {
    label: 'Length',
    units: ['m', 'cm', 'mm', 'km', 'ft', 'in', 'linear m'],
  },
  {
    label: 'Area',
    units: ['m²', 'cm²', 'ft²', 'sheet'],
  },
  {
    label: 'Volume',
    units: ['L', 'mL', 'm³', 'gal'],
  },
  {
    label: 'Packaging',
    units: ['Box', 'Carton', 'Pallet', 'Roll', 'Reel', 'Drum', 'Bag', 'Packages'],
  },
  {
    label: 'Time & services',
    units: ['Hours', 'Days', 'Weeks', 'Months', 'Services', 'Licenses'],
  },
];

/** Flattened, in group order — for a plain `<select>` or a validation hint. */
export const UNIT_SUGGESTIONS: readonly string[] = UNIT_GROUPS.flatMap(
  (group) => group.units,
);

/** What a line is quoted in when nothing says otherwise. */
export const DEFAULT_UNIT = 'Units';
