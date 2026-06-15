import { describe, expect, it } from "vitest";
import { generateOpml, normalizeFeedUrl, parseFeedXml, parseOpml } from "./index.js";

describe("rss package", () => {
  it("normalizes feed URLs for storage", () => {
    expect(normalizeFeedUrl(" https://user:pass@example.com/feed.xml#top ")).toBe(
      "https://example.com/feed.xml"
    );
  });

  it("parses RSS channel metadata and items", () => {
    const feed = parseFeedXml(
      `<?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <title>Example RSS</title>
          <link>https://example.com/</link>
          <description>Example description</description>
          <item>
            <title>First item</title>
            <link>/first</link>
            <guid>guid-1</guid>
            <pubDate>Thu, 14 May 2026 08:00:00 GMT</pubDate>
            <description>Short &amp; useful</description>
            <content:encoded><![CDATA[<p>Full <strong>content</strong></p>]]></content:encoded>
          </item>
        </channel>
      </rss>`,
      "https://example.com/feed.xml"
    );

    expect(feed).toMatchObject({
      title: "Example RSS",
      siteUrl: "https://example.com/",
      description: "Example description",
      items: [
        {
          title: "First item",
          url: "https://example.com/first",
          guid: "guid-1",
          summary: "Short & useful",
          contentHtml: "<p>Full <strong>content</strong></p>",
          contentText: "Full content"
        }
      ]
    });
    expect(feed.items[0].publishedAt).toBe(Date.parse("2026-05-14T08:00:00.000Z"));
  });

  it("rejects non-http RSS site and item URLs while preserving safe relative item URLs", () => {
    const feed = parseFeedXml(
      `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Example RSS</title>
          <link>javascript:alert(1)</link>
          <item>
            <title>Unsafe item</title>
            <link>javascript:alert(1)</link>
            <guid>unsafe-guid</guid>
          </item>
          <item>
            <title>Relative item</title>
            <link>/post/1</link>
            <guid>relative-guid</guid>
          </item>
        </channel>
      </rss>`,
      "https://example.com/feed.xml"
    );

    expect(feed.siteUrl).toBeNull();
    expect(feed.items[0].url.startsWith("https://example.com/feed.xml#item-")).toBe(true);
    expect(feed.items[1].url).toBe("https://example.com/post/1");
  });

  it("parses Atom feed entries", () => {
    const feed = parseFeedXml(
      `<feed xmlns="http://www.w3.org/2005/Atom">
        <title>Example Atom</title>
        <link href="https://example.com/"/>
        <entry>
          <title>Atom entry</title>
          <id>tag:example.com,2026:entry</id>
          <link rel="alternate" href="https://example.com/atom-entry"/>
          <updated>2026-05-14T09:00:00.000Z</updated>
          <author><name>Ada</name></author>
          <summary>Entry summary</summary>
        </entry>
      </feed>`,
      "https://example.com/atom.xml"
    );

    expect(feed.items[0]).toMatchObject({
      title: "Atom entry",
      url: "https://example.com/atom-entry",
      guid: "tag:example.com,2026:entry",
      author: "Ada",
      summary: "Entry summary"
    });
  });

  it("rejects non-http Atom links", () => {
    const feed = parseFeedXml(
      `<feed xmlns="http://www.w3.org/2005/Atom">
        <title>Example Atom</title>
        <link href="data:text/html,hello"/>
        <entry>
          <title>Atom entry</title>
          <id>file:///etc/passwd</id>
          <link rel="alternate" href="file:///etc/passwd"/>
          <updated>2026-05-14T09:00:00.000Z</updated>
        </entry>
      </feed>`,
      "https://example.com/atom.xml"
    );

    expect(feed.siteUrl).toBeNull();
    expect(feed.items[0].url.startsWith("https://example.com/atom.xml#item-")).toBe(true);
  });

  it("parses OPML folders and assigns feeds to the nearest parent folder", () => {
    const opml = parseOpml(`<?xml version="1.0" encoding="UTF-8"?>
      <opml version="2.0">
        <head><title>Subscriptions</title></head>
        <body>
          <outline text="Tech">
            <outline title="AI">
              <outline type="rss" text="ML Feed" xmlUrl="https://example.com/ml.xml" htmlUrl="https://example.com/ml" />
            </outline>
          </outline>
          <outline text="Loose Feed" type="rss" xmlUrl="https://example.com/loose.xml" />
        </body>
      </opml>`);

    expect(opml).toEqual({
      title: "Subscriptions",
      folders: ["Tech", "AI"],
      feeds: [
        {
          title: "ML Feed",
          feedUrl: "https://example.com/ml.xml",
          siteUrl: "https://example.com/ml",
          folderTitle: "AI"
        },
        {
          title: "Loose Feed",
          feedUrl: "https://example.com/loose.xml",
          siteUrl: null,
          folderTitle: null
        }
      ]
    });
  });

  it("generates OPML 2.0 that can be parsed back", () => {
    const xml = generateOpml({
      title: "Dibao Subscriptions",
      folders: [
        {
          title: "Design & Tech",
          feeds: [
            {
              title: "Example <Feed>",
              feedUrl: "https://example.com/feed.xml",
              siteUrl: "https://example.com/"
            }
          ]
        }
      ],
      feeds: [
        {
          title: "Loose",
          feedUrl: "https://example.com/loose.xml"
        }
      ]
    });

    expect(xml).toContain('<opml version="2.0">');
    expect(xml).toContain("Design &amp; Tech");
    expect(parseOpml(xml)).toMatchObject({
      title: "Dibao Subscriptions",
      folders: ["Design & Tech"],
      feeds: [
        {
          title: "Example <Feed>",
          feedUrl: "https://example.com/feed.xml",
          folderTitle: "Design & Tech"
        },
        {
          title: "Loose",
          feedUrl: "https://example.com/loose.xml",
          folderTitle: null
        }
      ]
    });
  });
});
