# 法國文化與數位資料工作搜尋配置

這份配置獨立保存在 `config/france-nonacademic/portals.yml`。原有根目錄 `portals.yml`、可能存在的學術配置、履歷與追蹤紀錄均不需要改動。`config/local-paths.txt` 將此資料夾宣告為使用者設定，避免上游更新覆寫。

## 驗證與執行

在儲存庫根目錄執行，需要 Node.js 18 以上及專案既有依賴。如果尚未安裝，先執行 `npm ci --ignore-scripts`，本配置的 HTTP 搜尋與測試不需要安裝瀏覽器。

```bash
# 完全離線：格式、provider 路由與未支援來源
node france-culture.mjs --check

# 既有格式驗證器，明確指定獨立檔案
node validate-portals.mjs --file config/france-nonacademic/portals.yml

# 完全離線：法語標題、聘用條件、parser 與真正 scan.mjs 整合測試
node --test tests/france-culture.test.mjs tests/providers/enssib.test.mjs

# 日後需要搜尋時才執行，連線但不寫入職缺清單
node france-culture.mjs --scan --dry-run --json

# 日後需要儲存搜尋結果時才執行
node france-culture.mjs --scan --json
```

`--check` 不搜尋職缺。測試使用合成案例，沒有執行定期追蹤。這次僅讀取 Enssib 公開列表及一頁詳情來確認 HTML 結構，沒有進行完整職缺掃描，也沒有建立排程。

`--scan` 透過既有 `scan.mjs` 執行。它明確指定獨立的設定與資料根目錄，預設將結果存至：

- `data/france-nonacademic/data/pipeline.md`
- `data/france-nonacademic/data/scan-history.tsv`
- 同目錄下的 `scan-runs.tsv` 及來源健康紀錄

若已有 `CAREER_OPS_ROOT` 等外部資料根目錄，上述相對路徑放在該資料根目錄內。既有 `CAREER_OPS_PORTALS`、追蹤紀錄及 pipeline 環境設定不會被套進這個搜尋流程。移除獨立配置不影響其他搜尋。

## 來源支援範圍

2026-10-19 檢查目前儲存庫 `6326eb5` 的搜尋器、provider registry、`validate-portals.mjs`、`verify-portals.mjs` 及 `audit-portals.mjs`。後兩者處理連線與內容稽核，不能單憑首頁可讀就推定已有 parser。既有 `audit-portals.mjs` 的命令主要讀取 `tracked_companies`，本次新增的 `--check` 同時檢查 `job_boards`。

| 來源 | 本配置中的用途 | 自動擷取狀態及限制 |
|---|---|---|
| [Enssib 公開職缺](https://emplois-stages.enssib.fr/) | 檔案、圖書館、文件與資訊服務優先來源 | 本次新增 `enssib` provider，解析列表、下一頁及詳情。只使用公開平台，不讀取 alumni 平台。預設最多 10 頁，到上限會警示。列表結構異常會回報錯誤，詳情失敗則保留職缺並註記條件未知。 |
| [Welcome to the Jungle](https://www.welcometothejungle.com/fr/jobs) | 法國與遠端的數位出版／資料工作 | 既有 `wttj` provider，使用公開 Algolia 介面。法國搜尋以 `offices.country_code:FR` 限定，另有遠端搜尋。每個查詢最多取 200 筆，不能宣稱完整涵蓋。公用搜尋金鑰由來源即時取得，沒有寫入配置。此回合未做完整連線掃描。 |
| [Choisir le service public](https://choisirleservicepublic.gouv.fr/nos-offres/) | 文化部門、文化資產、公共圖書館 | 現有 provider 沒有對應，保留網站搜尋查詢，HTTP 條目停用。新增列表／API parser 前，不能宣稱自動涵蓋。 |
| [Emploi territorial](https://www.emploi-territorial.fr/) | 地方檔案館與文化機構 | 同上，需要專用列表及詳情 parser。 |
| [ProfilCulture](https://www.profilculture.com/) | 文化機構及數位出版 | 同上，需要專用 parser，不能用 WTTJ provider 代替。 |
| [BnF](https://www.bnf.fr/)／[Bpi](https://www.bpi.fr/) | 數位館藏、文件與資料職務 | 機構網站搜尋，實際公告可能轉至公部門平台。沒有直接宣稱其人事系統受既有 provider 支援。 |
| [CNRS](https://emploi.cnrs.fr/) | 資料治理、語料與數位人文的研究支援職務 | 官網區分研究與研究支援職缺。查詢聚焦後者，尚需專用 parser。博士後與博士生職缺不納入這份配置。 |
| [OpenEdition](https://www.openedition.org/)、[Huma-Num](https://www.huma-num.fr/)、[ABES](https://abes.fr/)、[Inist](https://www.inist.fr/) | 數位出版與研究資料服務 | 多個公告頁／部落格，優先使用限定網站的查詢。若要自動擷取，需各自驗證 RSS、列表或招聘系統，尚未新增 parser。 |

`search_queries` 是供 career-ops 的代理人／WebSearch 搜尋流程使用的查詢。**純 HTTP 的 `scan.mjs` 不執行這些查詢**，本次也沒有執行它們。未支援的網站保留 `enabled: false`，因此不會默默算入自動涵蓋率。

WTTJ 的 `include_all_offices: true` 會保留多工作地點，避免法國辦公室排在第二個位置時，被本地地點篩選錯誤排除。這個選項只對本配置啟用，其他配置維持原有行為。

## 標題及條件判準

`title_filter` 完整獨立，不合併範例中的 AI／ML／LLM 正向關鍵字。它重用既有的重音符號正規化、`stem:` 詞首比對及 ` + ` 多詞交集，沒有把正規表示式誤當成一般關鍵字。

| 案例 | 預期 |
|---|---|
| `chargé`、`chargée`、`chargé·e`、`chargé(e)`、`chargé/e`、`CHARGE DE DONNEES` | 保留 |
| `chef`、`cheffe`、`chef·fe`、`chef(fe)` de projet numérique | 保留。若已取得詳情，需有文化、文件、出版或研究脈絡，詳情缺少時保留待看。 |
| `éditrice numérique`、`éditeur numérique`、`ingénieur·e TEI-XML` | 保留 |
| `Digital Archivist — AI-assisted cataloguing` | 保留，提及 AI 不構成排除理由 |
| `Senior AI Engineer`、`ML Engineer`、`LLM Software Engineer` | 不符合本配置標題，排除 |
| `Stage archiviste`、博士生、博士後、教師職缺 | 由標題排除，維持獨立的非學術就業範圍 |
| 已知法國地點／一般遠端／地點缺少 | 保留。一般遠端不等於已確認可在法國受僱。 |
| 已辨識外國地點，例如 `Berlin, Germany`，且沒有法國或遠端選項 | 由就業條件篩選排除。外國地名清單可擴充。 |
| 明確無薪、志工職務，或 `Remote UK-only`／`US-only` | 有明確且無衝突的證據時排除 |
| 薪資、工作許可或簽證支援未公開 | 保留，狀態為 `unknown` |
| 明載不提供簽證支援、要求工作許可、國籍限制或只收公務人員 | 保留並標記，未假設使用者已具備或缺少資格 |
| 條件互相矛盾，例如「CDD」同時寫「無薪」 | 保留，狀態為 `conflict`，供後續確認 |

`employment_filter` 是本次新增的選用篩選，只有配置中出現該區塊時才生效。字詞清單均保留在這份使用者配置。它依來源文字分類，不判定法律資格。地點沒有國名、只寫不在清單內的小城鎮時，保留為未知，避免有限的法國城市名單漏掉實際相關工作。一般遠端職缺缺少法國限制資訊時仍是 `france_eligibility: unknown`。已辨識外國地點同時提供遠端選項時也保留待確認，單憑國名不否決遠端工作。`france_eligibility: yes` 表示來源列出法國地點或適用範圍，不代表已核實使用者的居留與受僱資格。

JSON receipt 的 `employment.offers` 會保留各欄狀態及匹配的條件字詞。這些是來源訊號，不是已完成的人工審核。清單備註也會保存狀態。`public_access: yes` 表示公告提到契約聘用管道，`no` 表示明載僅限公務人員，均不表示使用者本人資格已核實。

薪資沒有最低門檻或幣別限制，數字未公開不排除。結構化薪資的正數或明載 CDI／CDD 等勞動契約可提供有薪訊號，數值 `0` 可能是來源的缺值代碼，不會自行解讀成無薪。工作許可與國籍只作註記，不使用會將缺少簽證說明排除的舊篩選模式。

Enssib 詳情提供較完整的聘用文字，WTTJ 目前列表介面通常沒有完整職務說明，因此後者較常出現 `unknown`。目前是可擴充的關鍵詞篩選，無法理解所有否定句及例外條款，後續評估仍應閱讀原公告。新增網站時優先保留完整職務說明，才能使用相同判準。

就業篩選的拒收計數計入既有 `filtered_content` 欄，避免改動歷史 TSV 格式。JSON 的 `employment.rejected` 另外提供其子計數。
