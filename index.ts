/**
 * VaultDMs — Revenge plugin
 *
 * Written entirely with React.createElement() — no JSX — so esbuild needs
 * zero JSX configuration and the file compiles as plain TypeScript.
 *
 * How to open the vault (no visible UI element):
 *   Triple-tap the "Direct Messages" header in your DM list within 600 ms.
 *
 * Patch summary
 * ─────────────
 * A) after   getPrivateChannelIds     → strip vaulted IDs from DM list
 * B) after   DirectMessageList/etc.   → wrap header text in triple-tap zone
 * C) instead showSimplifiedDMContextMenu / showChannelContextMenu
 *                                     → inject Move/Remove from Vault option
 * D) registerSettings                 → PIN management page in Revenge settings
 */
 
import { findByProps, findByName, findByDisplayName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { storage } from "@vendetta/plugin";
import { after, instead } from "@vendetta/patcher";
import { registerSettings } from "@vendetta/ui/settings";
 
// ─── Shorthand ────────────────────────────────────────────────────────────────
 
const ce = React.createElement;
 
// ─── Types ────────────────────────────────────────────────────────────────────
 
interface PluginStorage {
  pinHash:    string;   // SHA-256 hex, empty = not set
  vaultedIds: string[]; // channel IDs hidden in vault
}
 
// ─── Storage ──────────────────────────────────────────────────────────────────
 
const pluginStorage = storage as unknown as PluginStorage;
if (pluginStorage.pinHash == null)           pluginStorage.pinHash    = "";
if (!Array.isArray(pluginStorage.vaultedIds)) pluginStorage.vaultedIds = [];
 
// ─── SHA-256 ──────────────────────────────────────────────────────────────────
 
async function sha256(text: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
  } catch {
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
    return (h >>> 0).toString(16);
  }
}
 
// ─── Runtime state ────────────────────────────────────────────────────────────
 
let vaultUnlocked = false;
let overlayKey: string | null = null;
 
// ─── React Native refs ────────────────────────────────────────────────────────
 
const {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, FlatList, Alert, ScrollView,
} = ReactNative;
 
// ─── Design tokens ────────────────────────────────────────────────────────────
 
const C = {
  bg: "#1e1f22", surface: "#2b2d31", border: "#3c3f45",
  blurple: "#5865f2", white: "#ffffff", muted: "#b5bac1",
  placeholder: "#72767d", danger: "#ed4245",
};
 
// ─── Styles ───────────────────────────────────────────────────────────────────
 
const S = StyleSheet.create({
  flex1:          { flex: 1, backgroundColor: C.bg },
  center:         { flex: 1, alignItems: "center" as const, justifyContent: "center" as const,
                    backgroundColor: C.bg, paddingHorizontal: 24 },
 
  // PIN screen
  pinTitle:       { fontSize: 22, fontWeight: "700" as const, color: C.white,
                    marginBottom: 6, textAlign: "center" as const },
  pinSub:         { fontSize: 14, color: C.muted, marginBottom: 32, textAlign: "center" as const },
  pinDots:        { flexDirection: "row" as const, marginBottom: 32, gap: 12 },
  pinDot:         { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: C.blurple },
  pinDotFilled:   { backgroundColor: C.blurple },
  pinKeypad:      { flexDirection: "row" as const, flexWrap: "wrap" as const,
                    width: 252, gap: 12, justifyContent: "center" as const },
  pinKey:         { width: 72, height: 72, borderRadius: 36, backgroundColor: C.surface,
                    alignItems: "center" as const, justifyContent: "center" as const },
  pinKeyDel:      { backgroundColor: C.border },
  pinKeyTxt:      { fontSize: 26, color: C.white, fontWeight: "500" as const },
  pinNote:        { color: C.muted, fontSize: 12, marginTop: 20,
                    textAlign: "center" as const, maxWidth: 260 },
 
  // Vault screen
  header:         { flexDirection: "row" as const, alignItems: "center" as const,
                    padding: 16, borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: C.border },
  headerBack:     { color: C.blurple, fontSize: 16, marginRight: 12 },
  headerTitle:    { fontSize: 18, fontWeight: "700" as const, color: C.white },
  vaultRow:       { flexDirection: "row" as const, alignItems: "center" as const,
                    paddingHorizontal: 16, paddingVertical: 13,
                    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  vaultIcon:      { fontSize: 22, marginRight: 12 },
  vaultLabel:     { fontSize: 16, fontWeight: "600" as const, color: C.white },
  vaultSub:       { fontSize: 12, color: C.muted },
  emptyEmoji:     { fontSize: 48, marginBottom: 12 },
  emptyTitle:     { fontSize: 18, fontWeight: "700" as const, color: C.white, marginBottom: 6 },
  emptySub:       { fontSize: 14, color: C.muted, textAlign: "center" as const },
 
  // Settings
  settingsInner:  { padding: 20 },
  settingsTitle:  { fontSize: 18, fontWeight: "700" as const, color: C.white, marginBottom: 4 },
  settingsSub:    { fontSize: 13, color: C.muted, marginBottom: 16 },
  settingsHint:   { fontSize: 12, color: C.muted, marginBottom: 20, lineHeight: 18 },
  settingsHintBold: { color: C.white, fontWeight: "600" as const },
  input:          { backgroundColor: C.surface, borderRadius: 8, color: C.white,
                    fontSize: 16, padding: 12, marginBottom: 12,
                    borderWidth: 1, borderColor: C.border },
  btn:            { backgroundColor: C.blurple, borderRadius: 8, padding: 14,
                    alignItems: "center" as const, marginTop: 4 },
  btnDanger:      { backgroundColor: C.danger, marginTop: 24 },
  btnTxt:         { color: C.white, fontSize: 15, fontWeight: "600" as const },
  sectionTitle:   { fontSize: 12, fontWeight: "600" as const, color: C.muted,
                    textTransform: "uppercase" as const, letterSpacing: 0.8,
                    marginBottom: 8, marginTop: 28 },
  vaultedItem:    { flexDirection: "row" as const, justifyContent: "space-between" as const,
                    alignItems: "center" as const, paddingVertical: 10,
                    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  vaultedItemTxt: { color: C.white, fontSize: 14 },
  vaultedRmvTxt:  { color: C.danger, fontSize: 13 },
  statusTxt:      { color: C.muted, marginTop: 10, textAlign: "center" as const },
});
 
// ─── Overlay helpers ──────────────────────────────────────────────────────────
 
function showOverlay(element: any): void {
  const LM = findByProps("pushLayer","popLayer") ?? findByProps("show","dismiss","LayerManager");
  if (!LM) { console.warn("[VaultDMs] LayerManager not found"); return; }
  const key = `VaultDMs_${Date.now()}`;
  overlayKey = key;
  if (typeof LM.pushLayer === "function") LM.pushLayer({ key, render: () => element });
  else if (typeof LM.show === "function") LM.show({ key, render: () => element });
}
 
function dismissOverlay(): void {
  if (!overlayKey) return;
  const LM = findByProps("pushLayer","popLayer") ?? findByProps("show","dismiss","LayerManager");
  if (!LM) { overlayKey = null; return; }
  if (typeof LM.popLayer === "function") LM.popLayer(overlayKey);
  else if (typeof LM.dismiss === "function") LM.dismiss(overlayKey);
  overlayKey = null;
}
 
// ─── Vault helpers ────────────────────────────────────────────────────────────
 
function isVaulted(id: string): boolean { return pluginStorage.vaultedIds.includes(id); }
function addToVault(id: string): void {
  if (!isVaulted(id)) pluginStorage.vaultedIds = [...pluginStorage.vaultedIds, id];
}
function removeFromVault(id: string): void {
  pluginStorage.vaultedIds = pluginStorage.vaultedIds.filter(v => v !== id);
}
function getChannelName(id: string): string {
  const ch = findByProps("getChannel")?.getChannel?.(id);
  return ch?.name ?? ch?.recipients?.[0]?.username ?? `DM ${id}`;
}
 
// ─── Triple-tap factory ───────────────────────────────────────────────────────
 
function makeTripleTap(onTriple: () => void) {
  let count = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    count++;
    if (timer) clearTimeout(timer);
    if (count >= 3) { count = 0; onTriple(); return; }
    timer = setTimeout(() => { count = 0; timer = null; }, 600);
  };
}
 
// ─── PinScreen ────────────────────────────────────────────────────────────────
 
function PinScreen({ onSubmit, title = "Enter PIN", subtitle = "Enter your PIN to continue", maxLen = 6 }:
  { onSubmit: (p: string) => void; title?: string; subtitle?: string; maxLen?: number }) {
 
  const [pin, setPin] = React.useState("");
 
  const handleKey = React.useCallback((key: string) => {
    if (key === "⌫") { setPin(p => p.slice(0,-1)); return; }
    if (pin.length >= maxLen) return;
    const next = pin + key;
    setPin(next);
    if (next.length === maxLen) { onSubmit(next); setPin(""); }
  }, [pin, maxLen, onSubmit]);
 
  const KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
 
  return ce(View, { style: S.center },
    ce(Text, { style: S.pinTitle }, title),
    ce(Text, { style: S.pinSub }, subtitle),
 
    // dots
    ce(View, { style: S.pinDots },
      ...Array.from({ length: maxLen }, (_, i) =>
        ce(View, { key: String(i), style: [S.pinDot, i < pin.length ? S.pinDotFilled : null] })
      )
    ),
 
    // keypad
    ce(View, { style: S.pinKeypad },
      ...KEYS.map((key, i) =>
        key === ""
          ? ce(View, { key: `sp${i}`, style: { width: 72, height: 72 } })
          : ce(TouchableOpacity, {
              key: key === "⌫" ? "del" : key,
              style: [S.pinKey, key === "⌫" ? S.pinKeyDel : null],
              onPress: () => handleKey(key),
              activeOpacity: 0.65,
            },
            ce(Text, { style: S.pinKeyTxt }, key)
          )
      )
    ),
 
    pluginStorage.pinHash === ""
      ? ce(Text, { style: S.pinNote }, "No PIN set yet.\nYou'll be asked to enter it twice to confirm.")
      : null
  );
}
 
// ─── VaultScreen ──────────────────────────────────────────────────────────────
 
function VaultScreen({ onClose }: { onClose: () => void }) {
  useProxy(pluginStorage);
 
  const PrivateChannelRow: any =
    findByDisplayName("PrivateChannelRow") ?? findByName("PrivateChannelRow") ?? null;
  const ChannelStore = findByProps("getChannel");
 
  const renderItem = ({ item: id }: { item: string }) => {
    const channel = ChannelStore?.getChannel?.(id);
    if (PrivateChannelRow && channel) {
      try { return ce(PrivateChannelRow, { key: id, channel }); } catch {}
    }
    return ce(View, { key: id, style: S.vaultRow },
      ce(Text, { style: S.vaultIcon }, "💬"),
      ce(View, null,
        ce(Text, { style: S.vaultLabel }, getChannelName(id)),
        ce(Text, { style: S.vaultSub }, `ID: ${id}`)
      )
    );
  };
 
  const isEmpty = pluginStorage.vaultedIds.length === 0;
 
  return ce(View, { style: S.flex1 },
    // header
    ce(View, { style: S.header },
      ce(TouchableOpacity, { onPress: onClose },
        ce(Text, { style: S.headerBack }, "← Back")
      ),
      ce(Text, { style: S.headerTitle }, "Private Vault")
    ),
    // body
    isEmpty
      ? ce(View, { style: S.center },
          ce(Text, { style: S.emptyEmoji }, "🗄️"),
          ce(Text, { style: S.emptyTitle }, "Vault is empty"),
          ce(Text, { style: S.emptySub }, `Long-press any DM and tap "Move to Vault"`)
        )
      : ce(FlatList, {
          data: pluginStorage.vaultedIds,
          keyExtractor: (id: string) => id,
          renderItem,
        })
  );
}
 
// ─── VaultSettings ────────────────────────────────────────────────────────────
 
export function VaultSettings() {
  useProxy(pluginStorage);
 
  const [oldPin,     setOldPin]     = React.useState("");
  const [newPin,     setNewPin]     = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [status,     setStatus]     = React.useState("");
 
  const hasPin = pluginStorage.pinHash !== "";
 
  const handleSave = async () => {
    if (newPin.length < 4)        { setStatus("❌ PIN must be at least 4 digits."); return; }
    if (newPin !== confirmPin)     { setStatus("❌ PINs do not match.");             return; }
    if (hasPin) {
      if (await sha256(oldPin) !== pluginStorage.pinHash) {
        setStatus("❌ Current PIN is incorrect."); return;
      }
    }
    pluginStorage.pinHash = await sha256(newPin);
    setOldPin(""); setNewPin(""); setConfirmPin("");
    setStatus("✅ PIN updated!");
  };
 
  const handleClear = () => Alert.alert(
    "Clear Vault",
    "All conversations will be removed from the vault and reappear in your DM list.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive",
        onPress: () => { pluginStorage.vaultedIds = []; setStatus("✅ Vault cleared."); } },
    ]
  );
 
  return ce(ScrollView, { style: { flex: 1, backgroundColor: C.bg },
    contentContainerStyle: S.settingsInner },
 
    ce(Text, { style: S.settingsTitle }, "VaultDMs"),
    ce(Text, { style: S.settingsSub },
      hasPin ? "Change your vault PIN below." : "No PIN set yet — create one below."
    ),
    ce(Text, { style: S.settingsHint },
      "To open the vault: go to your DM list and ",
      ce(Text, { style: S.settingsHintBold }, "triple-tap the \"Direct Messages\" header"), "."
    ),
 
    hasPin ? ce(TextInput, {
      style: S.input, placeholder: "Current PIN",
      placeholderTextColor: C.placeholder, secureTextEntry: true,
      keyboardType: "number-pad", value: oldPin,
      onChangeText: setOldPin, maxLength: 16,
    }) : null,
 
    ce(TextInput, {
      style: S.input,
      placeholder: hasPin ? "New PIN (min. 4 digits)" : "PIN (min. 4 digits)",
      placeholderTextColor: C.placeholder, secureTextEntry: true,
      keyboardType: "number-pad", value: newPin,
      onChangeText: setNewPin, maxLength: 16,
    }),
    ce(TextInput, {
      style: S.input, placeholder: "Confirm PIN",
      placeholderTextColor: C.placeholder, secureTextEntry: true,
      keyboardType: "number-pad", value: confirmPin,
      onChangeText: setConfirmPin, maxLength: 16,
    }),
 
    ce(TouchableOpacity, { style: S.btn, onPress: handleSave },
      ce(Text, { style: S.btnTxt }, hasPin ? "Change PIN" : "Set PIN")
    ),
 
    status ? ce(Text, { style: S.statusTxt }, status) : null,
 
    pluginStorage.vaultedIds.length > 0 ? ce(React.Fragment, null,
      ce(Text, { style: S.sectionTitle },
        `Vaulted Conversations (${pluginStorage.vaultedIds.length})`
      ),
      ...pluginStorage.vaultedIds.map(id =>
        ce(View, { key: id, style: S.vaultedItem },
          ce(Text, { style: S.vaultedItemTxt }, `💬 ${getChannelName(id)}`),
          ce(TouchableOpacity, { onPress: () => removeFromVault(id) },
            ce(Text, { style: S.vaultedRmvTxt }, "Remove")
          )
        )
      ),
      ce(TouchableOpacity, { style: [S.btn, S.btnDanger], onPress: handleClear },
        ce(Text, { style: S.btnTxt }, "Clear Entire Vault")
      )
    ) : null
  );
}
 
// ─── Screen flow ──────────────────────────────────────────────────────────────
 
function openVaultScreen(): void {
  showOverlay(ce(VaultScreen, {
    onClose() { vaultUnlocked = false; dismissOverlay(); }
  }));
}
 
function openPinScreen(): void {
  let pending: string | null = null;
 
  async function handleSubmit(pin: string): Promise<void> {
    if (pluginStorage.pinHash === "") {
      if (pending === null) {
        pending = pin;
        Alert.alert("Confirm PIN", "Enter the same PIN again to confirm.", [{ text: "OK" }]);
        return;
      }
      if (pin !== pending) {
        pending = null;
        Alert.alert("PIN mismatch", "The PINs did not match. Please try again.");
        return;
      }
      pluginStorage.pinHash = await sha256(pin);
      pending = null; vaultUnlocked = true; dismissOverlay(); openVaultScreen();
      return;
    }
    if (await sha256(pin) !== pluginStorage.pinHash) {
      Alert.alert("Wrong PIN", "Incorrect PIN. Please try again.");
      return;
    }
    vaultUnlocked = true; dismissOverlay(); openVaultScreen();
  }
 
  showOverlay(ce(PinScreen, {
    onSubmit: handleSubmit,
    title:    pluginStorage.pinHash === "" ? "Create PIN"  : "Enter PIN",
    subtitle: pluginStorage.pinHash === "" ? "Choose a PIN to protect your vault"
                                           : "Enter your PIN to continue",
  }));
}
 
// ─── Plugin lifecycle ─────────────────────────────────────────────────────────
 
const unpatches: Array<() => void> = [];
 
export default {
  onLoad() {
 
    // ── A: Strip vaulted IDs from the DM list ─────────────────────────────
    const PrivateChannelStore = findByProps("getPrivateChannelIds");
    if (PrivateChannelStore) {
      unpatches.push(after("getPrivateChannelIds", PrivateChannelStore,
        (_: unknown[], result: unknown) => {
          if (!Array.isArray(result)) return result;
          return result.filter((id: unknown) => typeof id === "string" && !isVaulted(id));
        }
      ));
    } else {
      console.warn("[VaultDMs] getPrivateChannelIds not found — vaulted DMs will still appear.");
    }
 
    // ── B: Triple-tap DM list header ──────────────────────────────────────
    const tripleTap = makeTripleTap(() => vaultUnlocked ? openVaultScreen() : openPinScreen());
 
    // Walk the React element tree and wrap any Text matching "Direct Messages"
    function wrapHeader(node: any): any {
      if (!node || typeof node !== "object") return node;
      if (
        node.type === Text &&
        typeof node.props?.children === "string" &&
        /direct\s*messages?|^dms?$/i.test(node.props.children)
      ) {
        return ce(TouchableOpacity, {
          key: node.key ?? "__vdms_tap__",
          onPress: tripleTap,
          activeOpacity: 1,
          style: { alignSelf: "flex-start" },
          accessible: false,
        }, node);
      }
      if (node.props?.children) {
        const newChildren = Array.isArray(node.props.children)
          ? node.props.children.map(wrapHeader)
          : wrapHeader(node.props.children);
        if (newChildren !== node.props.children)
          return React.cloneElement(node, {}, newChildren);
      }
      return node;
    }
 
    const dmCandidates = [
      "DirectMessageList", "PrivateChannelsList", "DMList",
      "DirectMessagesHeader", "PrivateChannelsHeader",
    ];
    let patched = false;
    for (const name of dmCandidates) {
      const Comp = findByName(name) ?? findByDisplayName(name);
      if (!Comp) continue;
      const obj = Comp.default != null ? Comp : { default: Comp };
      if (typeof obj.default !== "function") continue;
      unpatches.push(after("default", obj, (_: unknown[], result: any) => wrapHeader(result)));
      patched = true;
    }
    if (!patched) console.warn(
      "[VaultDMs] DM list component not found. Triple-tap unavailable. " +
      "Open vault via Revenge Settings → VaultDMs."
    );
 
    // ── C: Long-press context menu ─────────────────────────────────────────
    for (const prop of ["showSimplifiedDMContextMenu","showChannelContextMenu","showDMContextMenu"]) {
      const mod = findByProps(prop);
      if (!mod) continue;
      unpatches.push(instead(prop, mod, (args: any[], orig: (...a: any[]) => unknown) => {
        const arg0 = args[0];
        const channelId: string | undefined =
          typeof arg0 === "string" ? arg0
          : arg0?.channel?.id ?? arg0?.channelId ?? arg0?.id;
        if (!channelId) return orig(...args);
        const ch = findByProps("getChannel")?.getChannel?.(channelId);
        if (!ch || ch.guild_id) return orig(...args);
 
        const vaulted = isVaulted(channelId);
        Alert.alert(getChannelName(channelId), undefined, [
          {
            text: vaulted ? "🔓 Remove from Vault" : "🔒 Move to Vault",
            onPress: () => vaulted ? removeFromVault(channelId) : addToVault(channelId),
          },
          { text: "More options…", onPress: () => orig(...args) },
          { text: "Cancel", style: "cancel" },
        ]);
      }));
    }
 
    // ── D: Settings page ──────────────────────────────────────────────────
    const unreg = registerSettings("VaultDMs", VaultSettings);
    if (typeof unreg === "function") unpatches.push(unreg);
  },
 
  onUnload() {
    for (const up of [...unpatches].reverse()) {
      try { up(); } catch(e) { console.error("[VaultDMs] unpatch error:", e); }
    }
    unpatches.length = 0;
    vaultUnlocked = false;
    dismissOverlay();
  },
};
 