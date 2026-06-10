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
  // Additional outbreak-relevant countries
  ["central african republic", { iso_a2: "CF", name: "Central African Republic" }],
  ["south sudan", { iso_a2: "SS", name: "South Sudan" }],
  ["eritrea", { iso_a2: "ER", name: "Eritrea" }],
  ["djibouti", { iso_a2: "DJ", name: "Djibouti" }],
  ["gabon", { iso_a2: "GA", name: "Gabon" }],
  ["equatorial guinea", { iso_a2: "GQ", name: "Equatorial Guinea" }],
  ["guinea-bissau", { iso_a2: "GW", name: "Guinea-Bissau" }],
  ["benin", { iso_a2: "BJ", name: "Benin" }],
  ["togo", { iso_a2: "TG", name: "Togo" }],
  ["the gambia", { iso_a2: "GM", name: "Gambia" }],
  ["gambia", { iso_a2: "GM", name: "Gambia" }],
  ["mauritania", { iso_a2: "MR", name: "Mauritania" }],
  ["madagascar", { iso_a2: "MG", name: "Madagascar" }],
  ["burundi", { iso_a2: "BI", name: "Burundi" }],
  ["eswatini", { iso_a2: "SZ", name: "Eswatini" }],
  ["swaziland", { iso_a2: "SZ", name: "Eswatini" }],
  ["lesotho", { iso_a2: "LS", name: "Lesotho" }],
  ["congo", { iso_a2: "CG", name: "Congo" }],
  ["israel", { iso_a2: "IL", name: "Israel" }],
  ["palestine", { iso_a2: "PS", name: "Palestine" }],
  ["maldives", { iso_a2: "MV", name: "Maldives" }],
  ["mongolia", { iso_a2: "MN", name: "Mongolia" }],
  ["north korea", { iso_a2: "KP", name: "North Korea" }],
  ["timor-leste", { iso_a2: "TL", name: "Timor-Leste" }],
  ["fiji", { iso_a2: "FJ", name: "Fiji" }],
  ["cuba", { iso_a2: "CU", name: "Cuba" }],
  ["haiti", { iso_a2: "HT", name: "Haiti" }],
  ["dominican republic", { iso_a2: "DO", name: "Dominican Republic" }],
  ["jamaica", { iso_a2: "JM", name: "Jamaica" }],
  ["honduras", { iso_a2: "HN", name: "Honduras" }],
  ["guatemala", { iso_a2: "GT", name: "Guatemala" }],
  ["nicaragua", { iso_a2: "NI", name: "Nicaragua" }],
  ["costa rica", { iso_a2: "CR", name: "Costa Rica" }],
  ["panama", { iso_a2: "PA", name: "Panama" }],
  ["el salvador", { iso_a2: "SV", name: "El Salvador" }],
  ["greece", { iso_a2: "GR", name: "Greece" }],
  ["ireland", { iso_a2: "IE", name: "Ireland" }],
  ["serbia", { iso_a2: "RS", name: "Serbia" }],
  ["kazakhstan", { iso_a2: "KZ", name: "Kazakhstan" }],
  ["uzbekistan", { iso_a2: "UZ", name: "Uzbekistan" }],
];

function boundaryMatch(hay: string, alias: string, from = 0): number {
  let idx = hay.indexOf(alias, from);
  while (idx !== -1) {
    const before = idx === 0 ? " " : hay[idx - 1];
    const after = idx + alias.length >= hay.length ? " " : hay[idx + alias.length];
    if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) return idx;
    idx = hay.indexOf(alias, idx + 1);
  }
  return -1;
}

/**
 * Scan a text string for the first (longest-alias) country mention.
 * Returns the canonical country or null if none is found.
 */
export function resolveCountry(text: string | null | undefined): Country | null {
  if (!text) return null;
  const hay = text.toLowerCase();
  for (const [alias, country] of ALIASES) {
    if (boundaryMatch(hay, alias) !== -1) return country;
  }
  return null;
}

/**
 * Scan a text string for ALL distinct country mentions, in order of first
 * appearance. Longer aliases are matched first and their character span is
 * consumed so that a contained shorter alias (e.g. "Congo" inside "DR Congo")
 * is not double-counted.
 */
export function resolveCountries(text: string | null | undefined): Country[] {
  if (!text) return [];
  const hay = text.toLowerCase();
  const consumed = new Array<boolean>(hay.length).fill(false);
  const found: Array<{ country: Country; at: number }> = [];
  const seen = new Set<string>();

  for (const [alias, country] of ALIASES) {
    let from = 0;
    let idx = boundaryMatch(hay, alias, from);
    while (idx !== -1) {
      let overlaps = false;
      for (let i = idx; i < idx + alias.length; i++) if (consumed[i]) { overlaps = true; break; }
      if (!overlaps) {
        for (let i = idx; i < idx + alias.length; i++) consumed[i] = true;
        if (!seen.has(country.iso_a2)) {
          seen.add(country.iso_a2);
          found.push({ country, at: idx });
        }
      }
      from = idx + alias.length;
      idx = boundaryMatch(hay, alias, from);
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.country);
}
