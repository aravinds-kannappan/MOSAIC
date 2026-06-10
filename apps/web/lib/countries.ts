/**
 * Lightweight country resolver.
 *
 * Maps free-text location strings (extracted from WHO DON / ProMED titles) to a
 * canonical { iso_a2, name } pair. The ISO-A2 code is what the WorldMap keys on
 * (via its numeric→A2 table), so resolving to a real code is what lets an alert
 * actually colour a country on the map.
 */

export interface Country {
  iso_a2: string;
  name: string;
}

/**
 * Name / alias → canonical country. Keys are lower-cased. The list covers the
 * countries the WorldMap can render plus the most common WHO DON aliases.
 * Multi-word aliases are listed before shorter ones so longer matches win.
 */
const ALIASES: Array<[string, Country]> = [
  ["democratic republic of the congo", { iso_a2: "CD", name: "DR Congo" }],
  ["democratic republic of congo", { iso_a2: "CD", name: "DR Congo" }],
  ["dr congo", { iso_a2: "CD", name: "DR Congo" }],
  ["drc", { iso_a2: "CD", name: "DR Congo" }],
  ["republic of the congo", { iso_a2: "CG", name: "Congo" }],
  ["united states of america", { iso_a2: "US", name: "United States" }],
  ["united states", { iso_a2: "US", name: "United States" }],
  ["the united states", { iso_a2: "US", name: "United States" }],
  ["usa", { iso_a2: "US", name: "United States" }],
  ["u.s.a", { iso_a2: "US", name: "United States" }],
  ["united kingdom", { iso_a2: "GB", name: "United Kingdom" }],
  ["great britain", { iso_a2: "GB", name: "United Kingdom" }],
  ["england", { iso_a2: "GB", name: "United Kingdom" }],
  ["united arab emirates", { iso_a2: "AE", name: "United Arab Emirates" }],
  ["saudi arabia", { iso_a2: "SA", name: "Saudi Arabia" }],
  ["south korea", { iso_a2: "KR", name: "South Korea" }],
  ["republic of korea", { iso_a2: "KR", name: "South Korea" }],
  ["south africa", { iso_a2: "ZA", name: "South Africa" }],
  ["south sudan", { iso_a2: "SS", name: "South Sudan" }],
  ["sierra leone", { iso_a2: "SL", name: "Sierra Leone" }],
  ["côte d'ivoire", { iso_a2: "CI", name: "Côte d'Ivoire" }],
  ["cote d'ivoire", { iso_a2: "CI", name: "Côte d'Ivoire" }],
  ["ivory coast", { iso_a2: "CI", name: "Côte d'Ivoire" }],
  ["burkina faso", { iso_a2: "BF", name: "Burkina Faso" }],
  ["new zealand", { iso_a2: "NZ", name: "New Zealand" }],
  ["papua new guinea", { iso_a2: "PG", name: "Papua New Guinea" }],
  ["sri lanka", { iso_a2: "LK", name: "Sri Lanka" }],
  ["viet nam", { iso_a2: "VN", name: "Vietnam" }],
  ["vietnam", { iso_a2: "VN", name: "Vietnam" }],
  ["philippines", { iso_a2: "PH", name: "Philippines" }],
  ["united republic of tanzania", { iso_a2: "TZ", name: "Tanzania" }],
  ["tanzania", { iso_a2: "TZ", name: "Tanzania" }],
  ["china", { iso_a2: "CN", name: "China" }],
  ["india", { iso_a2: "IN", name: "India" }],
  ["brazil", { iso_a2: "BR", name: "Brazil" }],
  ["germany", { iso_a2: "DE", name: "Germany" }],
  ["france", { iso_a2: "FR", name: "France" }],
  ["japan", { iso_a2: "JP", name: "Japan" }],
  ["australia", { iso_a2: "AU", name: "Australia" }],
  ["canada", { iso_a2: "CA", name: "Canada" }],
  ["mexico", { iso_a2: "MX", name: "Mexico" }],
  ["nigeria", { iso_a2: "NG", name: "Nigeria" }],
  ["egypt", { iso_a2: "EG", name: "Egypt" }],
  ["algeria", { iso_a2: "DZ", name: "Algeria" }],
  ["morocco", { iso_a2: "MA", name: "Morocco" }],
  ["tunisia", { iso_a2: "TN", name: "Tunisia" }],
  ["libya", { iso_a2: "LY", name: "Libya" }],
  ["kenya", { iso_a2: "KE", name: "Kenya" }],
  ["uganda", { iso_a2: "UG", name: "Uganda" }],
  ["ethiopia", { iso_a2: "ET", name: "Ethiopia" }],
  ["somalia", { iso_a2: "SO", name: "Somalia" }],
  ["sudan", { iso_a2: "SD", name: "Sudan" }],
  ["rwanda", { iso_a2: "RW", name: "Rwanda" }],
  ["angola", { iso_a2: "AO", name: "Angola" }],
  ["ghana", { iso_a2: "GH", name: "Ghana" }],
  ["senegal", { iso_a2: "SN", name: "Senegal" }],
  ["mali", { iso_a2: "ML", name: "Mali" }],
  ["niger", { iso_a2: "NE", name: "Niger" }],
  ["zimbabwe", { iso_a2: "ZW", name: "Zimbabwe" }],
  ["zambia", { iso_a2: "ZM", name: "Zambia" }],
  ["mozambique", { iso_a2: "MZ", name: "Mozambique" }],
  ["malawi", { iso_a2: "MW", name: "Malawi" }],
  ["botswana", { iso_a2: "BW", name: "Botswana" }],
  ["namibia", { iso_a2: "NA", name: "Namibia" }],
  ["cameroon", { iso_a2: "CM", name: "Cameroon" }],
  ["chad", { iso_a2: "TD", name: "Chad" }],
  ["guinea", { iso_a2: "GN", name: "Guinea" }],
  ["liberia", { iso_a2: "LR", name: "Liberia" }],
  ["pakistan", { iso_a2: "PK", name: "Pakistan" }],
  ["afghanistan", { iso_a2: "AF", name: "Afghanistan" }],
  ["bangladesh", { iso_a2: "BD", name: "Bangladesh" }],
  ["nepal", { iso_a2: "NP", name: "Nepal" }],
  ["bhutan", { iso_a2: "BT", name: "Bhutan" }],
  ["iran", { iso_a2: "IR", name: "Iran" }],
  ["iraq", { iso_a2: "IQ", name: "Iraq" }],
  ["syria", { iso_a2: "SY", name: "Syria" }],
  ["lebanon", { iso_a2: "LB", name: "Lebanon" }],
  ["jordan", { iso_a2: "JO", name: "Jordan" }],
  ["yemen", { iso_a2: "YE", name: "Yemen" }],
  ["oman", { iso_a2: "OM", name: "Oman" }],
  ["qatar", { iso_a2: "QA", name: "Qatar" }],
  ["kuwait", { iso_a2: "KW", name: "Kuwait" }],
  ["bahrain", { iso_a2: "BH", name: "Bahrain" }],
  ["turkey", { iso_a2: "TR", name: "Turkey" }],
  ["türkiye", { iso_a2: "TR", name: "Turkey" }],
  ["russia", { iso_a2: "RU", name: "Russia" }],
  ["ukraine", { iso_a2: "UA", name: "Ukraine" }],
  ["myanmar", { iso_a2: "MM", name: "Myanmar" }],
  ["thailand", { iso_a2: "TH", name: "Thailand" }],
  ["cambodia", { iso_a2: "KH", name: "Cambodia" }],
  ["laos", { iso_a2: "LA", name: "Laos" }],
  ["malaysia", { iso_a2: "MY", name: "Malaysia" }],
  ["singapore", { iso_a2: "SG", name: "Singapore" }],
  ["indonesia", { iso_a2: "ID", name: "Indonesia" }],
  ["argentina", { iso_a2: "AR", name: "Argentina" }],
  ["chile", { iso_a2: "CL", name: "Chile" }],
  ["peru", { iso_a2: "PE", name: "Peru" }],
  ["colombia", { iso_a2: "CO", name: "Colombia" }],
  ["venezuela", { iso_a2: "VE", name: "Venezuela" }],
  ["ecuador", { iso_a2: "EC", name: "Ecuador" }],
  ["bolivia", { iso_a2: "BO", name: "Bolivia" }],
  ["paraguay", { iso_a2: "PY", name: "Paraguay" }],
  ["uruguay", { iso_a2: "UY", name: "Uruguay" }],
  ["guyana", { iso_a2: "GY", name: "Guyana" }],
  ["suriname", { iso_a2: "SR", name: "Suriname" }],
  ["italy", { iso_a2: "IT", name: "Italy" }],
  ["spain", { iso_a2: "ES", name: "Spain" }],
  ["portugal", { iso_a2: "PT", name: "Portugal" }],
  ["netherlands", { iso_a2: "NL", name: "Netherlands" }],
  ["belgium", { iso_a2: "BE", name: "Belgium" }],
  ["switzerland", { iso_a2: "CH", name: "Switzerland" }],
  ["austria", { iso_a2: "AT", name: "Austria" }],
  ["poland", { iso_a2: "PL", name: "Poland" }],
  ["sweden", { iso_a2: "SE", name: "Sweden" }],
  ["norway", { iso_a2: "NO", name: "Norway" }],
  ["denmark", { iso_a2: "DK", name: "Denmark" }],
  ["finland", { iso_a2: "FI", name: "Finland" }],
  ["romania", { iso_a2: "RO", name: "Romania" }],
  ["bulgaria", { iso_a2: "BG", name: "Bulgaria" }],
  ["croatia", { iso_a2: "HR", name: "Croatia" }],
  ["hungary", { iso_a2: "HU", name: "Hungary" }],
  ["czechia", { iso_a2: "CZ", name: "Czechia" }],
  ["czech republic", { iso_a2: "CZ", name: "Czechia" }],
  ["slovakia", { iso_a2: "SK", name: "Slovakia" }],
];

/**
 * Scan a text string for the first (longest-alias) country mention.
 * Returns the canonical country or null if none is found.
 */
export function resolveCountry(text: string | null | undefined): Country | null {
  if (!text) return null;
  const hay = text.toLowerCase();
  for (const [alias, country] of ALIASES) {
    // Word-boundary-ish match to avoid e.g. "guinea" inside "Guinea-Bissau"
    const idx = hay.indexOf(alias);
    if (idx === -1) continue;
    const before = idx === 0 ? " " : hay[idx - 1];
    const after = idx + alias.length >= hay.length ? " " : hay[idx + alias.length];
    if (/[a-z]/.test(before) || /[a-z]/.test(after)) continue;
    return country;
  }
  return null;
}
