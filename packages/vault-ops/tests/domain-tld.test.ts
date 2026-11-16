import { expect, test } from "bun:test";

import { suggestSubdomainMappings } from "../src/uri";
test("co.in / com.cn / com.tr subdomain suggestions use registrable domain", () => {
  const v: any = {
    items: [
      { name: "a", login: { uris: ["https://mail.tata.co.in/"] } },
      { name: "b", login: { uris: ["https://login.taobao.com.cn/"] } },
      { name: "c", login: { uris: ["https://my.sahibinden.com.tr/"] } },
      { name: "d", login: { uris: ["https://id.naver.co.kr/"] } },
    ],
  };
  expect(suggestSubdomainMappings(v, {})).toEqual({
    "mail.tata.co.in": "tata.co.in",
    "login.taobao.com.cn": "taobao.com.cn",
    "my.sahibinden.com.tr": "sahibinden.com.tr",
    "id.naver.co.kr": "naver.co.kr",
  });
});
