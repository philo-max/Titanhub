const Set<String> veneraAdultKeys = {
  'hitomi',
  'nhentai',
  'wnacg',
  'ehentai',
  'jm',
  'hcomic',
  'jcomic',
  'mh18',
};

const Set<String> veneraLoginRequiredKeys = {
  'picacg',
  'ehentai',
  'copy_manga_multi_accounts',
};

const Set<String> veneraConfigRequiredKeys = {
  'komga',
  'kavita',
  'lanraragi',
};

bool isAdultVeneraKey(String key) => veneraAdultKeys.contains(key.toLowerCase());

bool veneraNeedsLogin(String key) => veneraLoginRequiredKeys.contains(key.toLowerCase());

bool veneraNeedsConfig(String key) => veneraConfigRequiredKeys.contains(key.toLowerCase());

bool veneraEnabledByDefault(String key) =>
    !isAdultVeneraKey(key) && !veneraNeedsLogin(key) && !veneraNeedsConfig(key);

String veneraAccountSecretKey(String id) => 'titanhub.venera.account.$id';
