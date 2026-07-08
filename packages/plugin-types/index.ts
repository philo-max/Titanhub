export interface MediaItem {
  id: string;
  title: string;
  cover: string;
  description?: string;
  url?: string;
  updateInfo?: string;
}

export interface MediaDetail extends MediaItem {
  status?: string;
  author?: string;
  genres?: string[];
  lastUpdate?: string;
}

export interface Chapter {
  id: string;
  title: string;
  url?: string;
  chapterNo?: number;
}

export interface VideoSource {
  quality: string;
  url: string;
}

export type MediaType = 'anime' | 'manga' | 'novel' | 'movie';

export interface AggregatedMediaItem extends MediaItem {
  pluginId: string;
  pluginName: string;
  mediaType: MediaType;
}

export interface TitanhubPlugin {
  id: string;
  name: string;
  version: string;
  types: MediaType[];

  search(query: string): Promise<MediaItem[]>;
  explore?(type: MediaType): Promise<MediaItem[]>;
  getDetail(id: string): Promise<MediaDetail>;
  getChapters(id: string): Promise<Chapter[]>;

  getVideoUrl?(chapterId: string): Promise<VideoSource[]>; // anime / movie
  getImages?(chapterId: string): Promise<string[]>; // manga
  getContent?(chapterId: string): Promise<string>; // novel
}
