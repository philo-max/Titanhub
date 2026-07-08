import { getPlugin } from '../db/db';
import { PluginSandbox, SandboxResult } from './sandbox';
import type {
  MediaItem,
  MediaDetail,
  Chapter,
  VideoSource,
  MediaType,
} from '@titanhub/plugin-types';

export class PluginManager {
  /**
   * Helper to retrieve a plugin and initialize a sandbox for it.
   */
  private static async getSandbox(pluginId: string): Promise<PluginSandbox> {
    const dbPlugin = await getPlugin(pluginId);
    if (!dbPlugin) {
      throw new Error(`Plugin '${pluginId}' not found.`);
    }
    if (!dbPlugin.isActive) {
      throw new Error(`Plugin '${pluginId}' is deactivated.`);
    }
    return new PluginSandbox(pluginId, dbPlugin.code);
  }

  /**
   * Search media using a plugin.
   */
  static async search(pluginId: string, query: string): Promise<SandboxResult<MediaItem[]>> {
    try {
      const sandbox = await this.getSandbox(pluginId);
      return await sandbox.runMethod<MediaItem[]>('search', [query]);
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  /**
   * Explore featured/popular media of a given type using a plugin.
   */
  static async explore(pluginId: string, type: MediaType): Promise<SandboxResult<MediaItem[]>> {
    try {
      const sandbox = await this.getSandbox(pluginId);
      return await sandbox.runMethod<MediaItem[]>('explore', [type]);
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  /**
   * Get media details using a plugin.
   */
  static async getDetail(pluginId: string, mediaId: string): Promise<SandboxResult<MediaDetail>> {
    try {
      const sandbox = await this.getSandbox(pluginId);
      return await sandbox.runMethod<MediaDetail>('getDetail', [mediaId]);
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  /**
   * Get chapters using a plugin.
   */
  static async getChapters(pluginId: string, mediaId: string): Promise<SandboxResult<Chapter[]>> {
    try {
      const sandbox = await this.getSandbox(pluginId);
      return await sandbox.runMethod<Chapter[]>('getChapters', [mediaId]);
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  /**
   * Get video stream URLs (Anime / Movie).
   */
  static async getVideoUrl(
    pluginId: string,
    chapterId: string
  ): Promise<SandboxResult<VideoSource[]>> {
    try {
      const sandbox = await this.getSandbox(pluginId);
      return await sandbox.runMethod<VideoSource[]>('getVideoUrl', [chapterId]);
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  /**
   * Get reader page images (Manga).
   */
  static async getImages(pluginId: string, chapterId: string): Promise<SandboxResult<string[]>> {
    try {
      const sandbox = await this.getSandbox(pluginId);
      return await sandbox.runMethod<string[]>('getImages', [chapterId]);
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }

  /**
   * Get chapter text content (Novel).
   */
  static async getContent(pluginId: string, chapterId: string): Promise<SandboxResult<string>> {
    try {
      const sandbox = await this.getSandbox(pluginId);
      return await sandbox.runMethod<string>('getContent', [chapterId]);
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  }
}
