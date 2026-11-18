import { describe, expect, it } from 'vitest';
import { adaptVenera, upgradeLegacyVeneraCode } from './index';
import { VENERA_SHIM } from './venera-runtime';
import { PluginSandbox } from '../../server/src/plugins/sandbox';

const meta = { id: 'venera-home-fixture', name: '首页夹具' };
const comic = { id: 'c1', title: '推荐', cover: 'https://images.example/1.jpg' };

describe('Venera homepage bridge', () => {
  it.each([
    ['multiPageComicList', '{ comics: [comic], maxPage: 3 }', '1'],
    ['multiPartPage', '[{title:"推荐",comics:[comic]}]', 'null'],
    ['mixed', '{data:[{title:"推荐",comics:[comic]}]}', '0'],
  ])('loads the first %s page', async (type, result, page) => {
    const source = `class Home extends ComicSource {
      explore = [{type:${JSON.stringify(type)},load:async p=>{
        if(p!==${page})throw new Error('wrong page');
        const comic=${JSON.stringify(comic)};return ${result};
      }}];
    }`;
    const plugin = adaptVenera(source, meta);
    const response = await new PluginSandbox(plugin.code).runMethod('explore', ['manga']);
    expect(response).toMatchObject({ success: true, data: [comic] });
  });

  it('bridges object sources and first-page continuation loaders', async () => {
    for (const explore of [
      `async()=>[${JSON.stringify(comic)}]`,
      `[{type:'multiPageComicList',loadNext:async token=>{if(token!==null)throw Error('token');return {comics:[${JSON.stringify(comic)}]}}}]`,
    ]) {
      const plugin = adaptVenera(`globalThis.source={explore:${explore}};`, meta);
      expect(await new PluginSandbox(plugin.code).runMethod('explore', [])).toMatchObject({ success: true, data: [comic] });
    }
  });

  it('reports a missing homepage capability without pretending to return an empty page', async () => {
    const plugin = adaptVenera('class SearchOnly extends ComicSource {search={load:async()=>({comics:[]})}}', meta);
    expect(await new PluginSandbox(plugin.code).runMethod('explore', [])).toMatchObject({ success: false, error: expect.stringContaining('HOME_UNSUPPORTED') });
    expect(await new PluginSandbox(plugin.code).runMethod('search', ['test'])).toMatchObject({ success: true, data: [] });
  });

  it('preserves image loading headers and the existing chapter identity', async () => {
    const plugin = adaptVenera(`class Images extends ComicSource {comic={
      loadEp:async(id,ep)=>({images:['https://images.example/page?signature=one']}),
      onImageLoad:(url,id,ep)=>({headers:{Referer:'https://source.example/'+id+'/'+ep}})
    }}`, meta);
    expect(await new PluginSandbox(plugin.code).runMethod('getImages', ['comic::chapter'])).toMatchObject({
      success: true, data: [{ url: 'https://images.example/page?signature=one', headers: { Referer: 'https://source.example/comic/chapter' } }],
    });
  });

  it('upgrades installed wrappers without reinstalling or changing their source identities', async () => {
    const source = `const origin='https://source.example';class Legacy extends ComicSource {explore=[{type:'multiPageComicList',load:async()=>({comics:[{id:'old-id',title:'旧来源',cover:origin+'/cover'}]})}]}`;
    const legacy = `// Wrapped Venera class source "旧来源" by @titanhub/plugin-adapter\n${VENERA_SHIM}\n\n${source}\nconst __veneraInstance = new Legacy();\nglobalThis.plugin={search:async()=>[]};`;
    const upgraded = upgradeLegacyVeneraCode(legacy, meta);
    expect(upgraded).toBeTruthy();
    expect(await new PluginSandbox(upgraded!).runMethod('explore', [])).toMatchObject({ success: true, data: [{ id: 'old-id', title: '旧来源' }] });
    expect(upgradeLegacyVeneraCode(upgraded!, meta)).toBeNull();
    expect(upgradeLegacyVeneraCode('globalThis.plugin={};', meta)).toBeNull();
  });
});
