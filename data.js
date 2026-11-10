// `osm` is a POSIX regex matched against OpenStreetMap's `cuisine` tag (used by Overpass and in JS).
// `q` are name keywords for the Photon fallback search.
// `veg` / `nonveg`: whether the cuisine has real veg / non-veg options (drives the squad diet rules).
// `gtypes` → Google Nearby Search place types; `gtext` → Google Text Search query (for cuisines Google has no type for).
export const CUISINES = [
  { id: 'northindian', q: ['north indian', 'punjabi', 'dhaba'], name: 'North Indian', emoji: '🍛', tag: 'Butter. Naan. Repeat.', tone: '#E3D3C3', spice: 2, veg: true, nonveg: true,
    gtext: 'north indian restaurant',
    osm: 'north_indian|punjabi|mughlai|awadhi|(^|;)indian($|;)' },
  { id: 'southindian', q: ['dosa', 'udupi', 'south indian'], name: 'South Indian', emoji: '🥞', tag: 'Dosa supremacy, no debate.', tone: '#EADFCB', spice: 2, veg: true, nonveg: true,
    gtext: 'south indian restaurant dosa',
    osm: 'south_indian|udupi|kerala|chettinad|andhra|tamil|karnataka|dosa' },
  { id: 'biryani', q: ['biryani'], name: 'Biryani', emoji: '🍚', tag: 'Rice? No. Religion.', tone: '#D8CFC4', spice: 2, veg: true, nonveg: true,
    gtext: 'biryani restaurant',
    osm: 'biryani|hyderabadi|lucknowi' },
  { id: 'chaat', q: ['chaat', 'street food', 'pav bhaji'], name: 'Street Food & Chaat', emoji: '🥙', tag: 'Pani puri till we drop.', tone: '#D6DACB', spice: 3, veg: true, nonveg: false,
    gtext: 'chaat street food',
    osm: 'chaat|street_food|pav_bhaji|vada_pav|snack|momo' },
  { id: 'indochinese', q: ['chinese', 'momos'], name: 'Indo-Chinese', emoji: '🥡', tag: 'Chilli paneer, dry. Always.', tone: '#D9D9D4', spice: 3, veg: true, nonveg: true,
    gtypes: ['chinese_restaurant'],
    osm: 'chinese|indo_chinese|tibetan' },
  { id: 'pizza', q: ['pizza', 'italian'], name: 'Pizza & Italian', emoji: '🍕', tag: 'Extra cheese, zero regrets.', tone: '#E8E4DA', spice: 1, veg: true, nonveg: true,
    gtypes: ['pizza_restaurant', 'italian_restaurant'],
    osm: 'pizza|italian|pasta' },
  { id: 'burgers', q: ['burger'], name: 'Burgers', emoji: '🍔', tag: 'Double patty energy.', tone: '#CFCFB8', spice: 1, veg: true, nonveg: true,
    gtypes: ['hamburger_restaurant'],
    osm: 'burger|american|sandwich' },
  { id: 'cafe', q: ['cafe', 'coffee'], name: 'Café & Brunch', emoji: '☕', tag: 'Cold brew, warm vibes.', tone: '#EDE9E3', spice: 1, veg: true, nonveg: true,
    gtypes: ['cafe', 'coffee_shop', 'brunch_restaurant'],
    osm: 'coffee_shop|cafe|breakfast|brunch|bubble_tea' },
  { id: 'japanese', q: ['sushi', 'japanese', 'ramen'], name: 'Sushi & Japanese', emoji: '🍣', tag: 'Chopsticks, main character.', tone: '#DCD8CC', spice: 1, veg: false, nonveg: true,
    gtypes: ['japanese_restaurant', 'sushi_restaurant', 'ramen_restaurant'],
    osm: 'japanese|sushi|ramen' },
  { id: 'korean', q: ['korean'], name: 'Korean', emoji: '🍜', tag: 'K-drama but make it dinner.', tone: '#E5E1D8', spice: 3, veg: false, nonveg: true,
    gtypes: ['korean_restaurant'],
    osm: 'korean' },
  { id: 'panasian', q: ['thai', 'asian'], name: 'Thai & Pan-Asian', emoji: '🍲', tag: 'Green curry, big mood.', tone: '#D6DACB', spice: 2, veg: true, nonveg: true,
    gtypes: ['thai_restaurant', 'vietnamese_restaurant', 'indonesian_restaurant'],
    osm: 'thai|asian|pan_asian|vietnamese|burmese|malaysian' },
  { id: 'coastal', q: ['seafood', 'coastal', 'fish'], name: 'Coastal & Seafood', emoji: '🦐', tag: 'Goa trip, minus the trip.', tone: '#D9D5C7', spice: 3, veg: false, nonveg: true,
    gtypes: ['seafood_restaurant'],
    osm: 'seafood|goan|malvani|mangalorean|konkan|fish' },
  { id: 'thali', q: ['thali', 'gujarati', 'rajasthani'], name: 'Gujarati & Rajasthani Thali', emoji: '🍽️', tag: 'Unlimited refills. Unlimited love.', tone: '#EADFCB', spice: 1, veg: true, nonveg: false,
    gtext: 'thali restaurant',
    osm: 'gujarati|rajasthani|thali|marwari|maharashtrian' },
  { id: 'middleeast', q: ['shawarma', 'lebanese', 'kebab'], name: 'Lebanese & Shawarma', emoji: '🧆', tag: 'Hummus is a personality.', tone: '#E3D3C3', spice: 1, veg: true, nonveg: true,
    gtypes: ['lebanese_restaurant', 'middle_eastern_restaurant', 'turkish_restaurant', 'mediterranean_restaurant'],
    osm: 'lebanese|arab|middle_eastern|kebab|shawarma|turkish|mediterranean|persian' },
  { id: 'mexican', q: ['mexican', 'taco'], name: 'Mexican', emoji: '🌮', tag: 'Taco Tuesday, any day.', tone: '#D8CFC4', spice: 2, veg: true, nonveg: true,
    gtypes: ['mexican_restaurant'],
    osm: 'mexican|tex-mex|burrito|taco' },
  { id: 'continental', q: ['continental', 'steak', 'grill'], name: 'Continental & Steak', emoji: '🥩', tag: 'Fork, knife, fancy.', tone: '#D9D9D4', spice: 1, veg: false, nonveg: true,
    gtext: 'continental restaurant steak',
    osm: 'continental|european|steak_house|french|grill' },
  { id: 'bengali', q: ['bengali'], name: 'Bengali', emoji: '🐟', tag: 'Mishti after macher jhol.', tone: '#DCD8CC', spice: 2, veg: false, nonveg: true,
    gtext: 'bengali restaurant',
    osm: 'bengali' },
  { id: 'desserts', q: ['dessert', 'ice cream', 'waffle'], name: 'Desserts', emoji: '🍨', tag: 'Skip dinner. Straight to this.', tone: '#EDE9E3', spice: 0, veg: true, nonveg: false,
    gtypes: ['ice_cream_shop', 'bakery'],
    osm: 'dessert|ice_cream|cake|sweets|mithai|waffle|frozen_yogurt' },
];
export const CUISINE_BY_ID = Object.fromEntries(CUISINES.map(c => [c.id, c]));

export const BUDGETS = [
  { id: 1, sym: '₹', label: 'Under ₹300', sub: 'Pocket-friendly' },
  { id: 2, sym: '₹₹', label: '₹300 – 700', sub: 'Casual' },
  { id: 3, sym: '₹₹₹', label: '₹700 – 1,500', sub: 'Treat yourself' },
  { id: 4, sym: '₹₹₹₹', label: '₹1,500+', sub: 'Main character' },
];

export const DIETS = [
  { id: 'veg', label: 'Veg', emoji: '🥦' },
  { id: 'egg', label: 'Eggetarian', emoji: '🥚' },
  { id: 'nonveg', label: 'Non-veg', emoji: '🍗' },
  { id: 'jain', label: 'Jain', emoji: '🌿' },
  { id: 'vegan', label: 'Vegan', emoji: '🌱' },
];

export const SPICE = [
  { id: 1, label: 'Mild', emoji: '🌶️' },
  { id: 2, label: 'Medium', emoji: '🌶️🌶️' },
  { id: 3, label: 'Make me cry', emoji: '🌶️🌶️🌶️' },
];

export const ALLERGIES = ['Nuts', 'Dairy', 'Gluten', 'Seafood', 'Mushroom'];

export const AVATAR_TONES = ['#111110', '#6E6A60', '#A39E91', '#8B8F7A', '#B08F74', '#4A4A46', '#C9B9A3', '#7D8A87'];

export const BOT_NAMES = ['Priya', 'Kabir', 'Ananya', 'Rohan', 'Meera', 'Vihaan', 'Isha', 'Arjun'];
