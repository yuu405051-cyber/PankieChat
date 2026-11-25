PANKIECHAT — TYPING + PHOTO UPLOAD FIX

ဒီ ZIP ထဲက apply-fixes.js က မင်းရဲ့ လက်ရှိ app.js ကို အလိုအလျောက် ပြင်ပေးမယ့် patcher ပါ။

ပြင်ပေးမယ့်အရာများ
- Photo upload request ကို Backblaze B2 function ရဲ့ base64 / messageId / ok response နဲ့ ကိုက်ညီစေခြင်း
- XHR upload progress နဲ့ တကယ့် upload ရာခိုင်နှုန်းပြတဲ့ circular ring
- Phone ကနေ ရွေးတဲ့ image upload ကိုလည်း အတူတူပြင်ခြင်း
- b2-download ရဲ့ JSON base64 response ကို Blob ပြန်ပြောင်းပြီး ပုံ/ဗီဒီယို/ဖိုင်ပြခြင်း
- Chat header မှာ typing…
- Chat အတွင်း #typingIndicator မှာ Typing…
- Chat list preview မှာ Typing…
- Typing listener duplicate မဖြစ်အောင် စီမံခြင်း
- Unread count ကို increment မလုပ်ခင် null ပြန်မသတ်မှတ်တော့ခြင်း

အသုံးပြုပုံ
1. ZIP ကို Extract လုပ်ပါ။
2. apply-fixes.js ကို မင်း project ရဲ့ app.js ရှိတဲ့ folder ထဲ ကူးထည့်ပါ။
3. အဲဒီ folder ထဲမှာ VS Code Terminal ဖွင့်ပါ။
4. ဒီ command ကို run ပါ: node apply-fixes.js
5. "PankieChat fixes applied successfully." ပြရင် app.js ပြင်ပြီးပါပြီ။
6. app.js.backup ကို မူလဖိုင်အဖြစ် backup သိမ်းပေးထားပါတယ်။

မှတ်ချက်
- Node.js ရှိဖို့လိုပါတယ်။
- မင်းရဲ့ Netlify b2-upload function က base64, messageId ကို လက်ခံပြီး { ok: true } ပြန်ပေးတဲ့ version ဖြစ်ရပါမယ်။
- #typingIndicator element က index.html ထဲမှာ ရှိရင် chat အတွင်း typing ပြပါမယ်။ မရှိရင် header နဲ့ chat list typing က အလုပ်လုပ်နိုင်ပါတယ်။
