import sqlite3

conn = sqlite3.connect('orders.db')
c = conn.cursor()

# 테이블 목록
c.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = c.fetchall()
print("=== 테이블 목록 ===")
for t in tables:
    print(t[0])

# 각 테이블 스키마 및 데이터 출력
for table in tables:
    tname = table[0]
    print(f"\n=== {tname} 테이블 스키마 ===")
    c.execute(f"PRAGMA table_info({tname})")
    cols = c.fetchall()
    for col in cols:
        print(col)

    print(f"\n=== {tname} 데이터 ===")
    c.execute(f"SELECT * FROM {tname}")
    rows = c.fetchall()
    for row in rows:
        print(row)
    print(f"총 {len(rows)}건")

conn.close()
