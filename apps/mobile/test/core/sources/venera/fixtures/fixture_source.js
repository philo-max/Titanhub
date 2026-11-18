class FixtureSource extends ComicSource {
  name = "夹具漫画"
  key = "fixture_src"
  version = "1.0.0"
  minAppVersion = "1.0.0"
  url = "https://fixture.test/"

  settings = {
    domain: {
      title: "域名",
      type: "input",
      default: "https://fixture.test"
    },
    quality: {
      title: "画质",
      type: "select",
      options: [{ value: "hd", text: "高清" }, { value: "sd", text: "标清" }],
      default: "hd"
    }
  }

  account = {
    login: async (account, pwd) => {
      const res = await Network.post(`${this.loadSetting("domain")}/login`, { "Content-Type": "application/x-www-form-urlencoded" }, `u=${account}&p=${pwd}`)
      if (res.status !== 200) throw "Login failed: " + res.status
    },
    logout: () => { this.deleteData("token") },
    registerWebsite: "https://fixture.test/register"
  }

  explore = [{
    title: "夹具首页",
    type: "multiPartPage",
    load: async () => {
      const res = await Network.get(`${this.loadSetting("domain")}/home`, {})
      const doc = new HtmlDocument(res.body)
      const comics = doc.querySelectorAll("ul.list li").map(li => new Comic({
        id: li.querySelector("a").attributes["href"],
        title: li.querySelector("a").text,
        cover: li.querySelector("img").attributes["src"],
        subTitle: "副标题"
      }))
      doc.dispose()
      return [{ title: "推荐", comics: comics }]
    }
  }]

  search = {
    load: async (keyword, options, page) => {
      const res = await Network.get(`${this.loadSetting("domain")}/search?q=${encodeURIComponent(keyword)}&page=${page}`, {})
      const json = JSON.parse(res.body)
      return {
        comics: json.items.map(i => new Comic({ id: i.id, title: i.name, cover: i.cover, description: i.desc })),
        maxPage: json.pages
      }
    },
    optionList: []
  }

  comic = {
    loadInfo: async (id) => {
      const res = await Network.get(`${this.loadSetting("domain")}/comic/${id}`, {})
      const json = JSON.parse(res.body)
      const chapters = new Map()
      json.eps.forEach(e => chapters.set(e.id, e.title))
      return new ComicDetails({
        title: json.title,
        cover: json.cover,
        description: json.desc,
        tags: { "作者": [json.author], "标签": json.tags },
        chapters: chapters,
        updateTime: "2024-01-02"
      })
    },
    loadEp: async (comicId, epId) => {
      const res = await Network.get(`${this.loadSetting("domain")}/ep/${comicId}/${epId}`, {})
      return { images: JSON.parse(res.body).pages }
    },
    onImageLoad: (url, comicId, epId) => {
      return { url: url, headers: { Referer: "https://fixture.test/", "X-Ep": String(epId) } }
    }
  }
}
