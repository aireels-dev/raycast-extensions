import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  Icon,
  Color,
  LaunchProps,
  List,
  Action,
  ActionPanel,
  getPreferenceValues,
  Toast,
  showToast,
  getSelectedText,
} from "@raycast/api";
import { runAppleScript } from "run-applescript";
import fetch, { Response, AbortError } from "node-fetch";
import crypto, { randomUUID } from "crypto";
import fs from "fs";
import sound from "sound-play";
import { URLSearchParams } from "url";

// Unified management of multilingual text
function getLocalizedText(key: string, language: string, params?: { [key: string]: string | number }): string {
  const langCode = language.includes("2") ? language.split("2")[1] : language.split("2")[0];

  const texts: { [key: string]: { [lang: string]: string } } = {
    // Truncation related text
    truncatedMessage: {
      "zh-CHS": `\n\n*(文本过长，已截取前{limit}字符进行翻译)*`,
      en: `\n\n*(Text too long, truncated to first {limit} characters for translation)*`,
      ja: `\n\n*(テキストが長すぎます。最初の{limit}文字に切り詰められました)*`,
      ko: `\n\n*(텍스트가 너무 깁니다. 처음 {limit}자로 잘랐습니다)*`,
      fr: `\n\n*(Texte trop long, tronqué aux {limit} premiers caractères)*`,
      es: `\n\n*(Texto demasiado largo, truncado a los primeros {limit} caracteres)*`,
    },
    truncatedMetadata: {
      "zh-CHS": "文本过长，已截取前{limit}字符进行翻译",
      en: "Text truncated to first {limit} characters",
      ja: "{limit}文字に切り詰められました",
      ko: "{limit}자로 잘랐습니다",
      fr: "Tronqué aux {limit} premiers caractères",
      es: "Truncado a los primeros {limit} caracteres",
    },

    // UI text
    translationResult: {
      "zh-CHS": "翻译结果",
      en: "Translation Result",
      ja: "翻訳結果",
      ko: "번역 결과",
      fr: "Résultat de la traduction",
      es: "Resultado de la traducción",
    },
    originalText: {
      "zh-CHS": "原文",
      en: "Original Text",
      ja: "原文",
      ko: "원본",
      fr: "Texte original",
      es: "Texto original",
    },
    phonetic: {
      "zh-CHS": "音标",
      en: "Phonetic",
      ja: "発音",
      ko: "발음",
      fr: "Phonétique",
      es: "Fonética",
    },
    detail: {
      "zh-CHS": "详细",
      en: "Detail",
      ja: "詳細",
      ko: "상세",
      fr: "Détail",
      es: "Detalle",
    },
    webTranslate: {
      "zh-CHS": "网络翻译",
      en: "Web Translate",
      ja: "ウェブ翻訳",
      ko: "웹 번역",
      fr: "Traduction web",
      es: "Traducción web",
    },
    hint: {
      "zh-CHS": "提示",
      en: "Hint",
      ja: "ヒント",
      ko: "힌트",
      fr: "Indice",
      es: "Pista",
    },
    readOriginal: {
      "zh-CHS": "朗读原文",
      en: "Read Original",
      ja: "原文を読む",
      ko: "원본 읽기",
      fr: "Lire l'original",
      es: "Leer original",
    },
    readTranslated: {
      "zh-CHS": "朗读译文",
      en: "Read Translated",
      ja: "訳文を読む",
      ko: "번역문 읽기",
      fr: "Lire la traduction",
      es: "Leer traducción",
    },
  };

  let text = texts[key]?.[langCode] || texts[key]?.["en"] || key;

  // Replace parameters
  if (params) {
    Object.entries(params).forEach(([paramKey, paramValue]) => {
      text = text.replace(new RegExp(`{${paramKey}}`, "g"), String(paramValue));
    });
  }

  return text;
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.substring(0, limit) + "...";
}

export default function Command(props: LaunchProps<{ arguments: Arguments.Index }>) {
  const { text } = props.arguments;
  const { searchText, state, setState, setSearchTextAndTranslate } = useSearchText(text);

  return (
    <List
      searchText={searchText}
      isLoading={state.isLoading}
      onSearchTextChange={setSearchTextAndTranslate}
      searchBarPlaceholder={
        state.selection || state.clipboard
          ? `default search from ${state.clipboard ? "Clipboard" : state.selection ? "Selection" : ""}${
              state.searchText != "" ? " : " + state.searchText : ""
            }`
          : "input content wants to tranlate..."
      }
      isShowingDetail={!!state.translateResult?.translation}
      throttle
    >
      {state.translateResult ? (
        <Translate translate_result={state.translateResult} state={state} setState={setState} />
      ) : null}
    </List>
  );
}

async function showTranslationError(errorCode: string) {
  const errorMessage = `
  * error code: ${errorCode}.
  * you can find all error code in here. (https://ai.youdao.com/DOCSIRMA/html/自然语言翻译/API文档/文本翻译服务/文本翻译服务-API文档.html)`;
  await showToast({
    style: Toast.Style.Failure,
    title: "Translation Error",
    message: errorMessage,
  });
}

function Translate({
  translate_result,
  state,
  setState,
}: {
  translate_result: TranslateResult;
  state: TranslateState;
  setState: React.Dispatch<React.SetStateAction<TranslateState>>;
}) {
  useEffect(() => {
    if (translate_result && translate_result.errorCode && translate_result.errorCode !== "0") {
      showTranslationError(translate_result.errorCode);
    }
  }, [translate_result]);
  return (
    <>
      {translate_result.translation ? (
        <List.Section title={getLocalizedText("translationResult", translate_result.l)}>
          {translate_result.translation.map((item: string, index: number) => {
            const displayText =
              state.isTruncated && translate_result.translation && index === translate_result.translation.length - 1
                ? item +
                  "..." +
                  getLocalizedText("truncatedMessage", translate_result.l, { limit: state.charLimit || 200 })
                : item;

            return (
              <List.Item
                key={index}
                title={
                  index === 0
                    ? getLocalizedText("translationResult", translate_result.l)
                    : `${getLocalizedText("translationResult", translate_result.l)} ${index + 1}`
                }
                icon={{ source: Icon.Dot, tintColor: Color.Red }}
                detail={
                  <List.Item.Detail
                    markdown={displayText}
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label
                          title={getLocalizedText("originalText", translate_result.l)}
                          text={truncateText(state.searchText || "", 100)}
                        />
                        {translate_result.basic?.phonetic && (
                          <>
                            <List.Item.Detail.Metadata.Separator />
                            <List.Item.Detail.Metadata.Label
                              title={getLocalizedText("phonetic", translate_result.l)}
                              text={translate_result.basic.phonetic}
                            />
                          </>
                        )}
                        {state.isTruncated && (
                          <>
                            <List.Item.Detail.Metadata.Separator />
                            <List.Item.Detail.Metadata.Label
                              title={getLocalizedText("hint", translate_result.l)}
                              text={getLocalizedText("truncatedMetadata", translate_result.l, {
                                limit: state.charLimit || 200,
                              })}
                            />
                          </>
                        )}
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={
                  <TranslateResultActionPanel
                    setState={setState}
                    text={state.searchText}
                    copy_content={displayText}
                    language={translate_result.l}
                    url={
                      translate_result.webdict && translate_result.webdict.url
                        ? translate_result.webdict.url
                        : undefined
                    }
                    speak_url={translate_result.speakUrl}
                    tspeak_url={translate_result.tSpeakUrl}
                  />
                }
              />
            );
          })}
        </List.Section>
      ) : null}
      {translate_result.basic && translate_result.basic.explains && translate_result.basic.explains.length > 0 ? (
        <List.Section title={getLocalizedText("detail", translate_result.l)}>
          {translate_result.basic.explains.map((item: string, index: number) => (
            <List.Item
              key={index}
              title={item}
              icon={{ source: Icon.Dot, tintColor: Color.Blue }}
              actions={
                <TranslateResultActionPanel
                  copy_content={item}
                  language={translate_result.l}
                  url={
                    translate_result.webdict && translate_result.webdict.url ? translate_result.webdict.url : undefined
                  }
                />
              }
            />
          ))}
        </List.Section>
      ) : null}
      {translate_result.web && translate_result.web.length > 0 ? (
        <List.Section title={getLocalizedText("webTranslate", translate_result.l)}>
          {translate_result.web.map((item: TranslateWebResult, index: number) => (
            <List.Item
              key={index}
              title={item.value.join(", ")}
              icon={{ source: Icon.Dot, tintColor: Color.Yellow }}
              subtitle={item.key}
              actions={
                <TranslateResultActionPanel
                  copy_content={item.value.join(", ")}
                  language={translate_result.l}
                  url={
                    translate_result.webdict && translate_result.webdict.url ? translate_result.webdict.url : undefined
                  }
                />
              }
            />
          ))}
        </List.Section>
      ) : null}
    </>
  );
}

function TranslateResultActionPanel(props: {
  text?: string;
  copy_content: string;
  language: string;
  url: string | undefined;
  speak_url?: string;
  tspeak_url?: string;
  setState?: React.Dispatch<React.SetStateAction<TranslateState>>;
}) {
  const { text, copy_content, language, url, speak_url, tspeak_url, setState } = props;

  //if need to use modern translation page
  const { is_using_modern_web } = getPreferenceValues();
  let webURL = url;
  if (is_using_modern_web) {
    const lang = language.split("2")[0];
    webURL = text && lang ? `https://www.youdao.com/result?word=${encodeURIComponent(text)}&lang=${lang}` : url;
  }

  return (
    <ActionPanel>
      <Action.CopyToClipboard content={copy_content} />
      {webURL ? <Action.OpenInBrowser url={webURL} /> : null}
      <Action
        icon={Icon.Message}
        onAction={() => {
          if (speak_url && setState) {
            setState((oldState) => ({
              ...oldState,
              isLoading: true,
            }));
            //try speak url first, and if it does not return 200, turn to use defaut service
            try {
              pronunceIt(speak_url, text);
            } catch (error) {
              console.log(error);
            } finally {
              setState((oldState) => ({
                ...oldState,
                isLoading: false,
              }));
            }
          }
        }}
        shortcut={{ modifiers: ["ctrl"], key: "return" }}
        title={getLocalizedText("readOriginal", language)}
      />
      {speak_url ? (
        <Action
          icon={Icon.Message}
          onAction={() => {
            if (speak_url && setState) {
              setState((oldState) => ({
                ...oldState,
                isLoading: true,
              }));
              //try speak url first, and if it does not return 200, turn to use defaut service
              try {
                pronunceIt(tspeak_url, copy_content);
              } catch (error) {
                console.log(error);
              } finally {
                setState((oldState) => ({
                  ...oldState,
                  isLoading: false,
                }));
              }
            }
          }}
          shortcut={{ modifiers: ["shift"], key: "return" }}
          title={getLocalizedText("readTranslated", language)}
        />
      ) : null}
    </ActionPanel>
  );
}

function useSearchText(argText: string) {
  const [searchText, setSearchText] = useState(argText);
  const { state, translate, setState } = useTranslate(argText);

  const setSearchTextAndTranslate = function setSearchTextAndTranslate(translateText: string) {
    console.log(`set search text to |${translateText}|`);
    setSearchText(translateText);
    translate(translateText);
  };

  return {
    searchText: searchText,
    state: state,
    setState: setState,
    setSearchTextAndTranslate: setSearchTextAndTranslate,
  };
}

function useTranslate(argText: string) {
  const [state, setState] = useState<TranslateState>({
    searchText: argText,
    translateResult: undefined,
    selection: false,
    clipboard: false,
    isLoading: true,
    isTruncated: false,
    charLimit: 200,
  });
  const cancelRef = useRef<AbortController | null>(null);

  const translate = useCallback(
    async function translate(content: string) {
      const { is_search_clipboard, max_char_limit } = getPreferenceValues();
      const charLimit = parseInt(max_char_limit) || 200;
      let isSelection = false;
      let isClipboard = false;

      try {
        content = content || (await getSelectedText()).trim();
        isSelection = !!content;
      } catch (error) {
        console.log("get selected text error...");
      }

      try {
        if (!content && is_search_clipboard) {
          content = await runAppleScript("the clipboard");
          isClipboard = !!content;
        }
      } catch (error) {
        console.log("get clipboard text error...");
      }

      let isTruncated = false;
      const originalContent = content;
      if (content && content.length <= charLimit) {
        content = content.trim();
      } else if (content && content.length > charLimit) {
        content = content.substring(0, charLimit).trim();
        isTruncated = true;
      } else {
        content = "";
        isSelection = false;
        isClipboard = false;
      }

      cancelRef.current?.abort();
      cancelRef.current = new AbortController();
      setState((oldState) => ({
        ...oldState,
        isLoading: true,
        selection: isSelection,
        clipboard: isClipboard,
        searchText: originalContent,
        isTruncated: isTruncated,
        charLimit: charLimit,
      }));
      try {
        const result = await performTranslate(content, cancelRef.current.signal);
        setState((oldState) => ({
          ...oldState,
          translateResult: result,
          isLoading: false,
        }));
      } catch (error) {
        setState((oldState) => ({
          ...oldState,
          isLoading: false,
        }));

        if (error instanceof AbortError) {
          return;
        }

        console.error("search error", error);
        await showToast({ style: Toast.Style.Failure, title: "Could not perform search", message: String(error) });
      }
    },
    [cancelRef, setState]
  );

  return {
    state: state,
    translate: translate,
    setState: setState,
  };
}

async function performTranslate(searchText: string, signal: AbortSignal): Promise<TranslateResult | undefined> {
  console.log(`start to search |${searchText}|`);
  if (searchText.trim()) {
    return translateAPI(searchText, signal).then(async (response) => {
      return (await response.json()) as TranslateResult;
    });
  } else {
    return undefined;
  }
}

function generateSign(content: string, salt: string, curtime: number, app_key: string, app_secret: string) {
  const sha256 = crypto.createHash("sha256");
  sha256.update(app_key + getContentForSign(content) + salt + curtime + app_secret);
  const cipher = sha256.digest("hex");
  return cipher;
}

function getContentForSign(content: string) {
  return content.length > 20
    ? content.substring(0, 10) + content.length + content.substring(content.length - 10)
    : content;
}

function translateAPI(content: string, signal: AbortSignal): Promise<Response> {
  const { app_key, app_secret, from_language, to_language } = getPreferenceValues();
  const q = content;
  const salt = randomUUID();
  const curtime = Math.floor(Date.now() / 1000);
  const sign = generateSign(q, salt, curtime, app_key, app_secret);
  const query = new URLSearchParams([
    ["q", q],
    ["from", from_language],
    ["to", to_language],
    ["appKey", app_key],
    ["salt", salt],
    ["sign", sign],
    ["signType", "v3"],
    ["curtime", curtime],
  ]);
  console.log(`${query}`);
  return fetch(`https://openapi.youdao.com/api`, {
    signal: signal,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: query.toString(),
  });
}

function pronunceIt(speak_url: string | undefined, speak_text: string | undefined): void {
  if (speak_url == undefined || speak_url.length === 0) {
    return;
  }
  fetch(speak_url)
    .then((res) => {
      if (res.status !== 200 && res.headers.get("Content-Type") === "audio/mp3" && speak_text != undefined) {
        return fetch(`http://dict.youdao.com/dictvoice?audio=${speak_text}`);
      } else {
        return res;
      }
    })
    .then((res) => {
      const fileStream = fs.createWriteStream("/tmp/tmp_raycast_simpleyd.mp3");
      res?.body?.pipe(fileStream);
      sound.play("/tmp/tmp_raycast_simpleyd.mp3");
    });
}

interface TranslateState {
  translateResult?: TranslateResult;
  searchText?: string;
  clipboard?: boolean;
  selection?: boolean;
  isLoading: boolean;
  isTruncated?: boolean;
  charLimit?: number;
}

interface TranslateResult {
  translation?: Array<string>;
  isWord: boolean;
  basic?: { phonetic?: string; explains?: Array<string> };
  l: string;
  web?: Array<TranslateWebResult>;
  webdict?: { url: string };
  speakUrl?: string;
  tSpeakUrl?: string;
  errorCode: string;
}

interface TranslateWebResult {
  value: Array<string>;
  key: string;
}
