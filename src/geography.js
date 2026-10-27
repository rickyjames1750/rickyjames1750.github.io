/** Approximate geographic anchor coordinates; world geometry is deliberately stylized. */
export const project = (lon, lat) => ({x:(lon + 122.3) * 235, z:(37.6 - lat) * 300});
const anchor = (value) => ({...value, ...project(value.lon, value.lat)});
export const sources = {
 caltrain:'https://www.caltrain.com/stations-zones',
 electric:'https://www.caltrain.com/news/caltrain-welcomes-first-passengers-new-electric-trains',
 portal:'https://www.tjpa.org/portaldtx/about-portal',
 transitCenter:'https://www.tjpa.org/salesforce-transit-center',
 southPark:'https://www.sfrecpark.org/576/South-Park',
 spc:'https://www.southparkcommons.com/',
 stanford:'https://visit.stanford.edu/basics',
 meta:'https://about.fb.com/es/company.info/'
};
export const stops = [
 {id:'about',label:'About me',place:'South Park · San Francisco',lat:37.7810,lon:-122.3938,source:sources.southPark},
 {id:'experience',label:'Experience',place:'South San Francisco',lat:37.6558,lon:-122.4046,source:'https://www.caltrain.com/station/southsf'},
 {id:'projects',label:'Projects',place:'Redwood City',lat:37.4852,lon:-122.2320,source:'https://www.caltrain.com/station/redwoodcity'},
 {id:'education',label:'Education',place:'Palo Alto',lat:37.4430,lon:-122.1648,source:'https://www.caltrain.com/station/paloalto'},
 {id:'contact',label:'Say hello',place:'Mountain View',lat:37.3944,lon:-122.0767,source:'https://www.caltrain.com/station/mountainview'}
].map(anchor);
export const landmarks = [
 {id:'golden-gate',name:'Golden Gate Bridge',lat:37.8199,lon:-122.4783},
 {id:'salesforce',name:'Salesforce Tower / Park',lat:37.7897,lon:-122.3968},
 {id:'south-park',name:'South Park',lat:37.7814,lon:-122.3945},
 {id:'spc',name:'South Park Commons',lat:37.78064,lon:-122.39404},
 {id:'stanford',name:'Stanford University',lat:37.4275,lon:-122.1697},
 {id:'meta',name:'Meta · Menlo Park',lat:37.4850,lon:-122.1484},
 {id:'google',name:'Google · Mountain View',lat:37.4220,lon:-122.0841},
 {id:'sfo',name:'SFO',lat:37.6213,lon:-122.3790},
 {id:'bay-bridge',name:'Bay Bridge',lat:37.8100,lon:-122.3480}
].map(anchor);
/** Generalized centerline: preserve correct station order, not a surveyed track alignment. */
export const railCoordinates = [
 [-122.3949,37.7764], // Current SF terminus: Fourth & King, at surface.
 [-122.3952,37.7691],
 [-122.3924,37.7577], // 22nd Street
 [-122.4014,37.7425],
 [-122.4013,37.7095], // Bayshore
 [-122.3905,37.6942],
 [-122.3973,37.6747],
 [-122.4046,37.6558], // South San Francisco
 [-122.4112,37.6298], // San Bruno
 [-122.3868,37.6004], // Millbrae (SFO is EAST of this station)
 [-122.3620,37.5874], // Broadway
 [-122.3451,37.5793], // Burlingame
 [-122.3240,37.5680], // San Mateo
 [-122.3088,37.5532], // Hayward Park
 [-122.2970,37.5387], // Hillsdale
 [-122.2758,37.5208], // Belmont
 [-122.2600,37.5074], // San Carlos
 [-122.2320,37.4852], // Redwood City
 [-122.1812,37.4547], // Menlo Park
 [-122.1648,37.4430], // Palo Alto
 [-122.1427,37.4292], // California Avenue
 [-122.1064,37.4072], // San Antonio
 [-122.0767,37.3944]  // Mountain View
];
/** Future Portal concept only. Not today's operating Caltrain service. */
export const futurePortalCoordinates = [
 [-122.3968,37.7897], // Below Salesforce Transit Center
 [-122.3950,37.7870], // 2nd Street corridor
 [-122.3898,37.7792], // Townsend/2nd
 [-122.3949,37.7764]  // Fourth & King connection
];
/** Coastlines are hand-generalized geographic silhouettes; all pairs are [longitude, latitude]. */
export const peninsulaCoast = [
 [-122.515,37.812],[-122.482,37.810],[-122.463,37.807],[-122.443,37.807],[-122.420,37.808],[-122.402,37.808],[-122.390,37.793],[-122.386,37.778],[-122.389,37.762],[-122.377,37.754],[-122.366,37.735],[-122.375,37.716],[-122.379,37.706],[-122.369,37.690],[-122.372,37.665],[-122.356,37.650],[-122.361,37.638],[-122.383,37.637],[-122.383,37.624],[-122.357,37.617],[-122.348,37.600],[-122.322,37.584],[-122.300,37.576],[-122.281,37.559],[-122.247,37.545],[-122.228,37.524],[-122.197,37.514],[-122.177,37.494],[-122.147,37.486],[-122.130,37.468],[-122.112,37.460],[-122.096,37.445],[-122.062,37.438],[-122.034,37.426],[-122.005,37.419],[-121.981,37.395],[-121.950,37.380],[-121.940,37.340],[-122.030,37.300],[-122.140,37.320],[-122.245,37.400],[-122.340,37.475],[-122.430,37.520],[-122.490,37.590],[-122.500,37.650],[-122.496,37.700],[-122.510,37.745],[-122.515,37.780]
];
export const eastBayCoast = [
 [-122.380,37.900],[-122.325,37.885],[-122.308,37.847],[-122.305,37.817],[-122.335,37.806],[-122.320,37.786],[-122.291,37.787],[-122.270,37.760],[-122.250,37.737],[-122.235,37.708],[-122.199,37.685],[-122.178,37.661],[-122.152,37.628],[-122.120,37.591],[-122.106,37.556],[-122.084,37.522],[-122.055,37.487],[-122.017,37.455],[-121.981,37.430],[-121.960,37.404],[-121.940,37.400],[-121.860,37.440],[-121.890,37.600],[-121.970,37.790],[-122.140,37.940],[-122.280,37.980]
];
export const marinCoast = [
 [-122.550,37.950],[-122.440,37.940],[-122.430,37.905],[-122.445,37.872],[-122.476,37.859],[-122.478,37.834],[-122.491,37.827],[-122.515,37.834],[-122.540,37.831],[-122.585,37.854],[-122.620,37.890]
];
export const geographyNote = 'A stylized geographic journey. Landmarks are scenery, not claims of employment, study, membership, or affiliation. Salesforce rail connection is a future Portal concept.';
