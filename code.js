function getGyazoImageUrl(id) {
  try {
    const res = UrlFetchApp.fetch(
      `https://api.gyazo.com/api/oembed?url=https://gyazo.com/${id}`
    );
    const json = JSON.parse(res.getContentText());
    return json.url;
  } catch(e) {
    return null;
  }
}

function buildCard(id, originalUrl) {
  const imageUrl = getGyazoImageUrl(id);
  if (!imageUrl) return null;
  return {
    cardId: id,
    card: {
      sections: [{ widgets: [{
        image: {
          imageUrl: imageUrl,
          altText: "Gyazo",
          onClick: { openLink: { url: originalUrl } }
        }
      }]}]
    }
  };
}

function postAdditionalCards(spaceName, cards) {
  try {
    const url = `https://chat.googleapis.com/v1/${spaceName}/messages`;
    UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ScriptApp.getOAuthToken(),
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({ cardsV2: cards })
    });
  } catch(e) {
    console.log("postAdditionalCards error:", e.toString());
  }
}

function onMessage(event) {
  const isSlashCommand = !!event.chat?.appCommandPayload;
  const payload = isSlashCommand 
    ? event.chat.appCommandPayload 
    : event.chat?.messagePayload;

  if (!payload?.message) {
    console.log("message not found");
    return {};
  }

  const message = payload.message;
  const space = payload.space;
  const text = message.text || "";
  const matchedUrl = message.matchedUrl?.url;

  const pattern = /https?:\/\/(?:[a-zA-Z0-9-]+\.)?gyazo\.com\/([a-zA-Z0-9]+)/g;
  const allText = matchedUrl ? text + " " + matchedUrl : text;
  const seen = new Set();
  const matches = [...allText.matchAll(pattern)].filter(m => {
    if (seen.has(m[1])) return false;
    seen.add(m[1]);
    return true;
  });

 if (!matches.length) return {
    hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text: "Gyazo URLを含めてください" } } } }
  };

  const cards = matches.map(m => buildCard(m[1], m[0])).filter(Boolean);
  if (!cards.length) return {
    hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text: "画像URLの取得に失敗しました" } } } }
  };

  // スラッシュコマンド、@メンション、またはURLのみ以外 → 全部返す
  if (isSlashCommand || !matchedUrl || text.includes('@')) {
    return {
      hostAppDataAction: { chatDataAction: { createMessageAction: { message: { cardsV2: cards } } } }
    };
  }

  // リンクプレビュー（URLのみ貼った場合）1枚目はインライン、2枚目以降は別送信
  if (cards.length > 1) {
    postAdditionalCards(space.name, cards.slice(1));
  }
  return {
    hostAppDataAction: { chatDataAction: { updateInlinePreviewAction: { cardsV2: [cards[0]] } } }
  };
}
