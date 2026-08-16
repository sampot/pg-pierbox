# 港口貨櫃（pg-pierbox）

十輪港口堆場調度遊戲。兩座橋式起重機持續送入貨櫃，玩家以每輪 3 點設備工時安排卸貨、場橋重排、臨時存放與裝船。

## 執行

無 build、無框架，直接以靜態伺服器執行：

```sh
python3 -m http.server 4173
```

開啟 <http://localhost:4173>。

## 測試

```sh
npx vitest run
```

規則測試涵蓋堆疊頂層、重量、危險品隔離、設備工點、船期、無合法空位、預分區與重排成本。

## 計分與保存

- 準時裝上正確船：+100
- 每次場內重排：−12
- 每個逾期櫃：−45
- 裝錯船：−80
- 無合法堆位：立即結束

最佳分數與班表解鎖分別透過 Playgrounds KV `pierbox:best`、`pierbox:unlocks` 保存；沒有 Host API 的靜態預覽仍可完整遊玩。

## 授權

程式碼 MIT。音效、音樂與 Cubic 字型見 [ATTRIBUTION.md](./ATTRIBUTION.md)。
