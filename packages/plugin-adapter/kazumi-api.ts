export interface KazumiApiRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  bodyType?: string;
  body?: unknown;
}

export interface KazumiSearchApiConfig {
  request: KazumiApiRequest;
  listPath: string;
  namePath: string;
  sourcePath: string;
  coverPath?: string;
  sourceTemplate?: string;
}

export interface KazumiChapterApiConfig {
  request: KazumiApiRequest;
  format: string;
  roadsPath?: string;
  roadNamePath?: string;
  episodesPath?: string;
  episodeNamePath?: string;
  episodeUrlPath?: string;
  roadNamesPath?: string;
  roadEpisodesPath?: string;
  roadSeparator?: string;
  episodeSeparator?: string;
  fieldSeparator?: string;
  episodePage?: { url: string; query?: Record<string, unknown> };
}

export const KAZUMI_API_RUNTIME = String.raw`
const API_MEDIA = new Map();
function apiPath(value, path) {
  if (!path) return [];
  if (!/^\$(?:(?:\.[\w-]+)|(?:\[(?:\d+|\*|"[^"]+"|'[^']+')\]))*$/.test(path)) {
    throw new Error('Unsupported Kazumi JSONPath: ' + path);
  }
  const parts = path.slice(1).match(/\.[\w-]+|\[(?:\d+|\*|"[^"]+"|'[^']+')\]/g) || [];
  return parts.reduce((values, part) => {
    const key = part[0] === '.' ? part.slice(1) : part.slice(1, -1).replace(/^["']|["']$/g, '');
    return values.flatMap(item => {
      if (item == null) return [];
      if (key === '*') return Array.isArray(item) ? item : Object.values(item);
      return Object.prototype.hasOwnProperty.call(Object(item), key) ? [item[key]] : [];
    });
  }, [value]);
}
function apiFirst(value, path) { return apiPath(value, path)[0]; }
function apiReplace(value, variables, encode) {
  if (typeof value === 'string') return value.replace(/@(keyword|source|episodeUrl|episodeName|roadName)/g, (_, key) => {
    const replacement = String(variables[key] == null ? '' : variables[key]);
    return encode ? encodeURIComponent(replacement) : replacement;
  });
  if (Array.isArray(value)) return value.map(item => apiReplace(item, variables, encode));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, apiReplace(item, variables, encode)]));
  return value;
}
function apiUrl(config, variables) {
  let url = absolutize(apiReplace(config.url, variables, true));
  const query = apiReplace(config.query || {}, variables, false);
  const pairs = Object.entries(query).map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  if (pairs.length) url += (url.includes('?') ? '&' : '?') + pairs.join('&');
  return url;
}
async function apiRequest(config, variables) {
  const headers = { ...HEADERS, ...apiReplace(config.headers || {}, variables, false) };
  const options = { method: (config.method || 'GET').toUpperCase(), headers };
  if (config.body != null && options.method !== 'GET' && options.method !== 'HEAD') {
    const body = apiReplace(config.body, variables, false);
    if (config.bodyType === 'json') {
      options.body = JSON.stringify(body);
      if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    } else if (config.bodyType === 'form' || config.bodyType === 'form-urlencoded') {
      options.body = Object.entries(body).map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value))).join('&');
      if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const response = await fetch(apiUrl(config, variables), options);
  if (response.ok === false || response.status >= 400) throw new Error('Kazumi API HTTP ' + response.status);
  return JSON.parse(await response.text());
}
async function apiSearch(keyword) {
  const config = RULE.searchApiConfig;
  const data = await apiRequest(config.request, { keyword });
  return apiPath(data, config.listPath).flatMap(item => {
    const title = apiFirst(item, config.namePath);
    let source = apiFirst(item, config.sourcePath);
    if (source == null || source === '' || !title) return [];
    source = String(source);
    if (config.sourceTemplate) source = apiReplace(config.sourceTemplate, { source }, true);
    const media = { id: encodeURIComponent(source), title: String(title), cover: absolutize(String(apiFirst(item, config.coverPath) || '')) };
    API_MEDIA.set(media.id, media);
    return [media];
  });
}
async function apiDetail(mediaId) {
  if (API_MEDIA.has(mediaId)) return API_MEDIA.get(mediaId);
  const source = decodeURIComponent(mediaId);
  const response = await apiRequest(RULE.chapterApiConfig.request, { source });
  const data = response.data || response.info || response;
  return { id: mediaId, title: String(data.title || data.vod_name || data.name || source), cover: absolutize(String(data.cover || data.vod_pic || '')), description: String(data.description || data.vod_content || '') };
}
async function apiChapters(mediaId) {
  const config = RULE.chapterApiConfig;
  const source = decodeURIComponent(mediaId);
  const data = await apiRequest(config.request, { source });
  let roads;
  if (config.format === 'delimited') {
    const names = String(apiFirst(data, config.roadNamesPath) || '').split(config.roadSeparator || '$$$');
    roads = String(apiFirst(data, config.roadEpisodesPath) || '').split(config.roadSeparator || '$$$').map((road, index) => ({
      name: names[index] || '',
      episodes: road.split(config.episodeSeparator || '#').filter(Boolean).map(episode => {
        const separator = config.fieldSeparator || '$';
        const position = episode.indexOf(separator);
        return position < 0 ? { name: '', url: episode } : { name: episode.slice(0, position), url: episode.slice(position + separator.length) };
      }),
    }));
  } else {
    roads = apiPath(data, config.roadsPath).map(road => ({
      name: String(apiFirst(road, config.roadNamePath) || ''),
      episodes: apiPath(road, config.episodesPath).map(episode => ({ name: apiFirst(episode, config.episodeNamePath), url: apiFirst(episode, config.episodeUrlPath) })),
    }));
  }
  const chapters = [];
  roads.forEach((road, roadIndex) => road.episodes.forEach((episode, index) => {
    if (episode.url == null || episode.url === '') return;
    const variables = { source, episodeUrl: episode.url, episodeName: episode.name, roadName: road.name };
    const url = config.episodePage ? apiUrl(config.episodePage, variables) : absolutize(String(episode.url));
    const prefix = roads.length > 1 ? (road.name || '线路' + (roadIndex + 1)) + '·' : '';
    chapters.push({ id: encodeURIComponent(url), title: prefix + (episode.name || '第 ' + (index + 1) + ' 话'), chapterNo: chapters.length + 1 });
  }));
  return chapters;
}
`;
