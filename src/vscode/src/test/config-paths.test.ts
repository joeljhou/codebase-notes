import assert from "node:assert/strict";
import test from "node:test";
import { configPathLocations } from "../core/config-paths.js";

test("配置路径展开压缩 key 并使用当前文本的准确范围", () => {
  const text = '{"version":3,"notes":{"src/main":{"cn/geekyspace/app":{"integration":"测试","Main.java":"入口"}}}}';
  assert.deepEqual(configPathLocations(text).map(({ key, offset, length }) => ({ key, source: text.slice(offset, offset + length) })), [
    { key: "src/main", source: "src/main" },
    { key: "src/main/cn/geekyspace/app", source: "cn/geekyspace/app" },
    { key: "src/main/cn/geekyspace/app/integration", source: "integration" },
    { key: "src/main/cn/geekyspace/app/Main.java", source: "Main.java" },
  ]);
});

test("逐段下划线转义、点号、Unicode 和 JSON 转义保留名称", () => {
  const text = '{"version":3,"notes":{"__private/__text/cn.example":{"\\u6587\\u6863/quote\\\"name.txt":"说明"}}}';
  const paths = configPathLocations(text);
  assert.deepEqual(paths.map(({ key }) => key), ["_private/_text/cn.example", '_private/_text/cn.example/文档/quote"name.txt']);
  assert.equal(text.slice(paths[1]!.offset, paths[1]!.offset + paths[1]!.length), '\\u6587\\u6863/quote\\\"name.txt');
});

test("备注、元数据、扩展字段和无效路径不生成链接", () => {
  const text = JSON.stringify({
    version: 3,
    notes: { src: { _text: "src/main", _meta: { style: "core", nested: { "src/main": "not path" } },
      "../bad": { child: "bad" }, "__private/_text": "bad", "a//b": "bad", "C:/a": "bad" } },
    extension: { "src/main": "other" },
  });
  assert.deepEqual(configPathLocations(text).map(({ key }) => key), ["src"]);
});

test("仅支持最新严格 JSON 配置，不为旧版、未来版本或半写入内容定位", () => {
  for (const version of ["1", "2", "4", "3.0", '"3"', "null"]) {
    assert.deepEqual(configPathLocations(`{"version":${version},"notes":{"src":"note"}}`), []);
  }
  for (const text of ['{"version":3,"notes":{"src":', '{"version":3,"notes":{"src":"note",}}', '{"notes":{"src":"note"}}']) {
    assert.deepEqual(configPathLocations(text), []);
  }
});
