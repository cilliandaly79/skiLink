/* skiLink core — data layer (Supabase)
   Every database call the app makes, in one place. Pass in a supabase-js client — the web app's
   (CDN build) or the native app's (@supabase/supabase-js with AsyncStorage). Each method returns
   supabase-js's usual {data, error}. Tables and security rules: supabase/schema.sql. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkiCore = Object.assign(root.SkiCore || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const now = () => new Date().toISOString();
const today = () => new Date().toLocaleDateString('en-CA');   // YYYY-MM-DD, local day

function createApi(sb){
  return {
    // profiles
    getProfile:      (uid) => sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
    insertProfile:   (uid, fields) => sb.from('profiles').insert({id:uid, ...fields}).select().single(),
    updateProfile:   (uid, fields) => sb.from('profiles').update({...fields, updated_at:now()}).eq('id', uid).select().single(),
    profilesByIds:   (ids) => sb.from('profiles').select('id,username,display_name,color,skill').in('id', ids),
    findUser:        (username) => sb.rpc('find_user', {uname:username}),   // exact username only
    // friendships
    listFriendships: () => sb.from('friendships').select('*').order('created_at', {ascending:false}),
    sendRequest:     (uid, otherId) => sb.from('friendships').insert({requester:uid, addressee:otherId}),
    acceptRequest:   (id) => sb.from('friendships').update({status:'accepted'}).eq('id', +id),
    removeFriendship:(id) => sb.from('friendships').delete().eq('id', +id),
    // live positions (+ battery)
    liveLocations:   (ids) => sb.from('live_locations').select('*').in('user_id', ids),
    upsertLocation:  (row) => sb.from('live_locations').upsert({...row, updated_at:now()}),
    updateBattery:   (uid, fields) => sb.from('live_locations').update(fields).eq('user_id', uid),
    deleteLocation:  (uid) => sb.from('live_locations').delete().eq('user_id', uid),
    // removes the user's profile, friendships, location, stats and sign-in (supabase/schema.sql: delete_my_account)
    deleteAccount:   () => sb.rpc('delete_my_account'),
    // today's stats
    dayStats:        (ids, day) => sb.from('day_stats').select('*').eq('day', day || today()).in('user_id', ids),
    upsertDayStats:  (uid, s) => sb.from('day_stats').upsert({user_id:uid, day:today(), top_speed:Math.round(s.top * 10) / 10,
                       vertical:Math.round(s.vert), runs:s.runs, distance:Math.round(s.dist), updated_at:now()}),
  };
}

return {createApi, today};
});
