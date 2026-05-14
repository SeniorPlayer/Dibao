import { describe, expect, it } from "vitest";
import { normalizeFeedUrl, parseFeedXml } from "./index.js";

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
});
