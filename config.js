// KHAO config.
// Leave firebaseUrl empty to run in LOCAL mode (groups sync between tabs on this device only —
// handy for testing, with "test friends" you can add in the lobby).
// For real multi-phone groups, paste a Firebase Realtime Database URL (free Spark plan), e.g.
//   firebaseUrl: "https://khao-12345-default-rtdb.asia-southeast1.firebasedatabase.app"
// See README.md for the 2-minute setup and security rules.
// Restaurants come from free Overture Maps tiles in data/tiles/ (OpenStreetMap outside covered cities).
// googleMapsKey (optional): a browser key with "Maps Embed API" enabled (free, unlimited), restricted to
// your site's address. Without it the detail map uses Google's classic keyless embed.
// useGooglePlaces: true switches restaurant search to paid Google Places (needs "Places API (New)" on the key).
window.KHAO_CONFIG = {
  googleMapsKey: "",
  useGooglePlaces: false,
  firebaseUrl: "https://khao-10c77-default-rtdb.asia-southeast1.firebasedatabase.app"
};
