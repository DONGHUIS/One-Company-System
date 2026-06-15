"""
주문내역 조회 API - 해피톡 챗봇 에이전트 연동용
FastAPI + SQLite | 로컬 실행 후 ngrok으로 외부 노출
"""
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import RedirectResponse
from urllib.parse import quote
from datetime import datetime
from typing import Optional
import sqlite3
import httpx
import json
import base64
import os

#카페24 설정 
CAFE24_MALL_ID       = "pkpk001"
CAFE24_CLIENT_ID     = "P2WJN9wUKlcrl00DTpRyCB"     
CAFE24_CLIENT_SECRET = "s17aYveLZqteuG2rfS2abN" 
CAFE24_REDIRECT_URI  = "https://euphonic-henriette-unousted.ngrok-free.dev/callback"
CAFE24_API_VERSION   = "2026-03-01"
TOKEN_FILE           = "cafe24_token.json"

#토큰 저장/불러오기
def load_token() -> dict:
    if not os.path.exists(TOKEN_FILE):
        return {}
    with open(TOKEN_FILE) as f:
        return json.load(f)

def save_token(data: dict):
    with open(TOKEN_FILE, "w") as f:
        json.dump(data, f)

# ── Access Token 자동 갱신 ────────────────────────────────────
async def get_valid_token() -> str:
    token_data = load_token()
    if not token_data:
        raise HTTPException(status_code=401, detail="로그인 필요: /cafe24/login 접속")

    # 만료 5분 전까지는 기존 access_token 그대로 사용
    expires_at = datetime.fromisoformat(token_data.get("expires_at", "2000-01-01"))
    if datetime.now() < expires_at.replace(tzinfo=None) - __import__("datetime").timedelta(minutes=5):
        return token_data["access_token"]

    # 만료됐으면 refresh_token으로 갱신
    refresh_token = token_data.get("refresh_token")
    credentials = base64.b64encode(
        f"{CAFE24_CLIENT_ID}:{CAFE24_CLIENT_SECRET}".encode()
    ).decode()

    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"https://{CAFE24_MALL_ID}.cafe24api.com/api/v2/oauth/token",
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type":    "refresh_token",
                "refresh_token": refresh_token,
            },
        )

    if res.status_code != 200:
        raise HTTPException(status_code=401, detail="토큰 갱신 실패. /cafe24/login 재로그인 필요")

    new_token = res.json()
    save_token(new_token)
    return new_token["access_token"]

app = FastAPI(title="주문내역 API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
DB_PATH = "orders.db"


# ── DB 헬퍼 ───────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def rows_to_dicts(rows):
    return [dict(r) for r in rows]


# ── 서버 시작 시 테이블 + 샘플 데이터 생성 ────────────────
@app.on_event("startup")
def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            order_number  TEXT    NOT NULL UNIQUE,
            customer_name TEXT    NOT NULL,
            customer_phone TEXT   NOT NULL,
            product_name  TEXT    NOT NULL,
            quantity      INTEGER NOT NULL DEFAULT 1,
            price         INTEGER NOT NULL,
            status        TEXT    NOT NULL DEFAULT '주문접수',
            ordered_at    TEXT    NOT NULL,
            updated_at    TEXT    NOT NULL
        )
    """)

    if cur.execute("SELECT COUNT(*) FROM orders").fetchone()[0] == 0:
        now = datetime.now().isoformat()
        samples = [
            ("ORD-20260328-001", "피케이", "010-6682-2170", "아메리카노",   2,  9000, "배송완료", "2026-03-28 09:30:00"),
            ("ORD-20260330-002", "피케이", "010-6682-2170", "카페라떼",     1,  5500, "배송완료", "2026-03-30 14:00:00"),
            ("ORD-20260401-003", "김민수", "010-1234-5678", "바닐라라떼",   3, 18000, "배송중",   "2026-04-01 10:15:00"),
            ("ORD-20260402-004", "이서연", "010-9876-5432", "녹차프라페",   1,  6500, "주문접수", "2026-04-02 08:00:00"),
            ("ORD-20260401-005", "이서연", "010-9876-5432", "아메리카노",   5, 22500, "준비중",   "2026-04-01 16:30:00"),
            ("ORD-20260325-006", "박지훈", "010-5555-1234", "초코라떼",     2, 13000, "배송완료", "2026-03-25 11:00:00"),
        ]
        for s in samples:
            cur.execute(
                "INSERT INTO orders (order_number, customer_name, customer_phone, product_name, quantity, price, status, ordered_at, updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (*s, now),
            )
        conn.commit()
        print("✅ 샘플 데이터 6건 삽입 완료")
    conn.close()


# ── 엔드포인트 ────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "ok", "message": "주문내역 API 실행 중"}


@app.get("/orders")
def search_orders(
    customer_name:  Optional[str] = Query(None, description="고객 이름"),
    customer_phone: Optional[str] = Query(None, description="전화번호 (snake_case)"),
    customerPhone:  Optional[str] = Query(None, description="전화번호 (해피톡용 camelCase)"),
    status:         Optional[str] = Query(None, description="주문접수 | 준비중 | 배송중 | 배송완료"),
    limit:          int           = Query(20, ge=1, le=100),
):
    """고객 이름 또는 전화번호로 주문내역 검색"""
    conn = get_db()
    conditions, params = [], []

    # 해피톡은 customerPhone으로 보내므로 둘 다 받아서 합침
    phone = customer_phone or customerPhone

    if customer_name:
        conditions.append("customer_name = ?")
        params.append(customer_name)

    if phone:
        clean = phone.replace("-", "").replace(" ", "")
        conditions.append("REPLACE(customer_phone, '-', '') = ?")
        params.append(clean)

    if status:
        conditions.append("status = ?")
        params.append(status)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"SELECT * FROM orders {where} ORDER BY ordered_at DESC LIMIT ?"
    params.append(limit)

    rows = conn.execute(query, params).fetchall()
    conn.close()

    results = rows_to_dicts(rows)
    return {
        "count": len(results),
        "orders": results,
    }


@app.get("/orders/{order_number}")
def get_order(order_number: str):
    """주문번호로 단건 조회"""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM orders WHERE order_number = ?", (order_number,)
    ).fetchone()
    conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="주문을 찾을 수 없습니다")
    return dict(row)


@app.get("/orders/phone/{phone}")
def get_orders_by_phone(phone: str):
    """전화번호로 주문내역 조회 (경로 변수 방식)"""
    conn = get_db()
    clean = phone.replace("-", "").replace(" ", "")
    rows = conn.execute(
        "SELECT * FROM orders WHERE REPLACE(customer_phone, '-', '') = ? ORDER BY ordered_at DESC",
        (clean,)
    ).fetchall()
    conn.close()
    return {"count": len(rows), "orders": rows_to_dicts(rows)}


@app.get("/customer")
def get_customer_by_phone(
    customerPhone: Optional[str] = Query(None, description="전화번호 (해피톡용 camelCase)"),
    customer_phone: Optional[str] = Query(None, description="전화번호 (snake_case)"),
):
    """전화번호로 고객명 조회 - 해피톡 챗봇 전용 (customer_name 최상위 반환)"""
    phone = customerPhone or customer_phone
    if not phone:
        raise HTTPException(status_code=400, detail="전화번호를 입력해주세요")

    conn = get_db()
    clean = phone.replace("-", "").replace(" ", "")
    row = conn.execute(
        "SELECT customer_name FROM orders WHERE REPLACE(customer_phone, '-', '') = ? LIMIT 1",
        (clean,)
    ).fetchone()
    conn.close()

    if not row:
        return {"customer_name": "", "found": False}
    return {"customer_name": row["customer_name"], "found": True}


@app.get("/cafe24/login")
def cafe24_login():
    """브라우저에서 최초 1회 접속 → 카페24 로그인"""
    url = (
        f"https://{CAFE24_MALL_ID}.cafe24api.com/api/v2/oauth/authorize"
        f"?response_type=code"
        f"&client_id={CAFE24_CLIENT_ID}"
        f"&redirect_uri={quote(CAFE24_REDIRECT_URI, safe='')}"
        f"&scope=mall.read_product,mall.read_customer,mall.read_order"
    )
    return RedirectResponse(url)


@app.get("/callback")
async def cafe24_callback(
    code:  Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    """카페24 인증 후 자동 호출 → 토큰 저장"""
    if error or not code:
        raise HTTPException(status_code=400, detail=f"카페24 인증 실패: {error or '코드 없음'}")

    credentials = base64.b64encode(
        f"{CAFE24_CLIENT_ID}:{CAFE24_CLIENT_SECRET}".encode()
    ).decode()

    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"https://{CAFE24_MALL_ID}.cafe24api.com/api/v2/oauth/token",
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={
                "grant_type":   "authorization_code",
                "code":         code,
                "redirect_uri": CAFE24_REDIRECT_URI,
            },
        )

    if res.status_code != 200:
        raise HTTPException(status_code=400, detail=f"토큰 발급 실패: {res.text}")

    save_token(res.json())
    return {"status": "ok", "message": "로그인 완료. 이제 /cafe24/products 사용 가능합니다."}


@app.get("/cafe24/products")
async def get_cafe24_products(
    limit:  int           = Query(10, ge=1, le=100, description="조회 개수"),
    offset: int           = Query(0,  ge=0,         description="시작 위치"),
    product_name: Optional[str] = Query(None,       description="상품명 검색"),
):
    """카페24 상품 목록 조회 - 해피톡 챗봇 전용"""
    access_token = await get_valid_token()
    url = f"https://{CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/products"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type":  "application/json",
        "X-Cafe24-Api-Version": CAFE24_API_VERSION,
    }
    params = {"limit": limit, "offset": offset}
    if product_name:
        params["product_name"] = product_name

    async with httpx.AsyncClient() as client:
        res = await client.get(url, headers=headers, params=params)

    if res.status_code != 200:
        print(f"[Cafe24 오류] status={res.status_code} body={res.text}")
        raise HTTPException(status_code=res.status_code, detail=res.text)

    data = res.json()
    products = [
        {
            "product_no":   p.get("product_no"),
            "product_name": p.get("product_name"),
            "price":        p.get("price"),
            "stock":        p.get("stock_quantity"),
            "status":       p.get("display"),
        }
        for p in data.get("products", [])
    ]
    return {"count": len(products), "products": products}


@app.get("/cafe24/customer")
async def get_cafe24_customer(
    userPhone: Optional[str] = Query(None, description="휴대폰번호 (해피톡용)"),
    customer_phone: Optional[str] = Query(None, description="휴대폰번호"),
):
    """카페24 고객 휴대폰번호로 고객명 조회 - 해피톡 챗봇 전용"""
    phone = userPhone or customer_phone
    if not phone:
        raise HTTPException(status_code=400, detail="휴대폰번호를 입력해주세요")

    access_token = await get_valid_token()
    digits = phone.replace("-", "").replace(" ", "")
    # 카페24 형식: 010-XXXX-XXXX
    formatted = f"{digits[:3]}-{digits[3:7]}-{digits[7:]}" if len(digits) == 11 else digits

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type":  "application/json",
        "X-Cafe24-Api-Version": CAFE24_API_VERSION,
    }

    customers = []
    async with httpx.AsyncClient() as client:
        # 형식 포함(010-xxxx-xxxx)으로 먼저 시도
        res = await client.get(
            f"https://{CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/customers",
            headers=headers,
            params={"cellphone": formatted, "limit": 1},
        )
        if res.status_code == 200:
            customers = res.json().get("customers", [])

        # 결과 없으면 숫자만으로 재시도
        if not customers:
            res = await client.get(
                f"https://{CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/customers",
                headers=headers,
                params={"cellphone": digits, "limit": 1},
            )
            if res.status_code == 200:
                customers = res.json().get("customers", [])

    if res.status_code != 200:
        print(f"[Cafe24 고객조회 오류] status={res.status_code} body={res.text}")
        raise HTTPException(status_code=res.status_code, detail=res.text)

    if not customers:
        return {"member_id": "", "found": False}

    c = customers[0]
    print(f"[Cafe24 고객데이터] {c}")
    buyer_name = c.get("name") or c.get("nick_name") or c.get("member_id") or ""
    return {
        "member_id": buyer_name,
        "found": True,
    }


@app.get("/cafe24/orders")
async def get_cafe24_orders(
    userPhone:      Optional[str] = Query(None, description="휴대폰번호 (해피톡용)"),
    member_id:      Optional[str] = Query(None, description="회원 아이디"),
    order_id:       Optional[str] = Query(None, description="주문번호"),
    limit:          int           = Query(10, ge=1, le=100),
):
    """카페24 주문 조회 - 해피톡 챗봇 전용"""
    access_token = await get_valid_token()
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type":  "application/json",
        "X-Cafe24-Api-Version": CAFE24_API_VERSION,
    }

    from datetime import timedelta
    today = datetime.now()
    params = {
        "limit":      limit,
        "start_date": (today - timedelta(days=30)).strftime("%Y-%m-%d"),
        "end_date":   today.strftime("%Y-%m-%d"),
    }
    if member_id:
        params["member_id"] = member_id
    if order_id:
        params["order_id"] = order_id
    if userPhone:
        digits = userPhone.replace("-", "").replace(" ", "")
        params["buyer_cellphone"] = f"{digits[:3]}-{digits[3:7]}-{digits[7:]}" if len(digits) == 11 else digits

    print(f"[주문조회 파라미터] {params}")

    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"https://{CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/orders",
            headers=headers,
            params=params,
        )

    if res.status_code != 200:
        print(f"[Cafe24 주문조회 오류] status={res.status_code} body={res.text}")
        raise HTTPException(status_code=res.status_code, detail=res.text)

    orders = res.json().get("orders", [])
    print(f"[주문조회 결과] 총 {len(orders)}건")
    if orders:
        print(f"[주문조회 첫번째] billing_name={orders[0].get('billing_name')} order_id={orders[0].get('order_id')}")
    result = []
    async with httpx.AsyncClient() as client:
        for o in orders:
            canceled     = o.get("canceled") == "T"
            paid         = o.get("paid") == "T"
            shipping     = o.get("shipping_status", "F")
            shipping_map = {"F": "배송전", "D": "배송중", "T": "배송완료", "G": "배송완료"}

            if canceled:
                status = "취소"
            elif not paid:
                status = "결제대기"
            else:
                status = shipping_map.get(shipping, "결제완료")

            # 운송장 정보 조회
            carrier_name = ""
            tracking_no  = ""
            ship_status  = ""
            ship_res = await client.get(
                f"https://{CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/orders/{o['order_id']}/shipments",
                headers=headers,
            )
            if ship_res.status_code == 200:
                shipments = ship_res.json().get("shipments", [])
                if shipments:
                    print(f"[Cafe24 배송상세] {shipments[0]}")
                    code = shipments[0].get("shipping_company_code", "")
                    tracking_no = shipments[0].get("tracking_no", "")
                    carrier_map = {
                        "0001": "우체국택배",
                        "0002": "CJ대한통운",
                        "0003": "한진택배",
                        "0004": "롯데택배",
                        "0005": "현대택배",
                        "0006": "CJ대한통운",
                        "0007": "천일택배",
                        "0008": "합동택배",
                        "0009": "대신택배",
                        "0010": "경동택배",
                        "0011": "건영택배",
                        "0012": "로젠택배",
                        "0013": "드림택배",
                        "0014": "일양로지스",
                        "0015": "EMS",
                        "0016": "DHL",
                        "0017": "FedEx",
                        "0018": "UPS",
                        "0019": "GSMNtoN",
                        "0020": "KGB택배",
                        "0021": "CU편의점택배",
                        "0022": "GS편의점택배",
                    }
                    carrier_name = carrier_map.get(code, code)
                    ship_items = shipments[0].get("items", [])
                    ship_status_code = ship_items[0].get("status", "") if ship_items else ""
                    ship_status_map = {
                        "shipready": "배송준비",
                        "standby":   "배송대기",
                        "shipping":  "배송중",
                        "shipped":   "배송완료",
                        "returning": "반품중",
                        "returned":  "반품완료",
                        "exchanging":"교환중",
                    }
                    ship_status = ship_status_map.get(ship_status_code, ship_status_code)

            result.append({
                "order_id":     o.get("order_id"),
                "order_status": status,
                "billing_name": o.get("billing_name"),
                "carrier_name": carrier_name,
                "tracking_no":  tracking_no,
                "ship_status":  ship_status,
            })
    return {"count": len(result), "orders": result}


@app.get("/cafe24/orders/by-phone")
async def get_orders_by_phone(
    userPhone: str = Query(..., description="휴대폰번호"),
    limit:     int = Query(10, ge=1, le=100),
):
    """전화번호 입력 → 고객 조회 → 주문 조회 한번에 처리"""
    access_token = await get_valid_token()
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type":  "application/json",
        "X-Cafe24-Api-Version": CAFE24_API_VERSION,
    }

    # 1단계: 전화번호로 member_id 조회
    digits = userPhone.replace("-", "").replace(" ", "")
    formatted = f"{digits[:3]}-{digits[3:7]}-{digits[7:]}" if len(digits) == 11 else digits

    member_id = ""
    async with httpx.AsyncClient() as client:
        for phone in [formatted, digits]:
            res = await client.get(
                f"https://{CAFE24_MALL_ID}.cafe24api.com/api/v2/admin/customers",
                headers=headers,
                params={"cellphone": phone, "limit": 1},
            )
            if res.status_code == 200:
                customers = res.json().get("customers", [])
                if customers:
                    member_id = customers[0].get("member_id", "")
                    break

    if not member_id:
        return {"count": 0, "orders": [], "message": "해당 전화번호로 가입된 고객이 없습니다"}

    # 2단계: member_id로 주문 조회
    return await get_cafe24_orders(member_id=member_id, limit=limit, userPhone=None, order_id=None)