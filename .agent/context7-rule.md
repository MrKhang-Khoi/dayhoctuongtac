# Context7 Integration Rule

Khi viết hoặc sửa code liên quan đến bất kỳ thư viện/framework/SDK bên ngoài nào,
PHẢI tra cứu tài liệu mới nhất qua Context7 CLI trước khi viết code.

## Lệnh sử dụng

```bash
# Tìm library ID
npx ctx7 library <tên-thư-viện> "<mô-tả>"

# Lấy docs
npx ctx7 docs <library-id> "<câu-hỏi>"
```

## Ưu tiên

- Context7 docs > Training data cũ
- Luôn dùng API patterns từ Context7 thay vì đoán
- Đặc biệt quan trọng với: Firebase, Playwright, ESLint

## Library IDs đã verify

- Firebase JS SDK: `/firebase/firebase-js-sdk`
- Firebase Docs: `/websites/firebase_google`
- Playwright: `/microsoft/playwright`
- ESLint: `/eslint/eslint`
