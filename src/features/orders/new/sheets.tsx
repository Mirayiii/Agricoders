import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import Svg, { Circle, Line } from "react-native-svg";

import { BottomSheet, Button, Icon } from "@/components";
import { colors, radii, text } from "@/constants/theme";
import { formatMoney } from "@/utils/format";
import type { DeliveryTimeOption, OrderSourceOption } from "./newOrderData";
import { fromTime, timeLabel, toTime, type UnitOption } from "./newOrderLogic";

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const FACE = 232;
const NUMBER = 40;

/**
 * Figma "Select Time": hour and minute boxes, AM/PM, and a clock face.
 * The boxes are text fields too, so the time can be typed (screen readers,
 * keyboards, or a minute that is not on the face). Returns "HH:MM".
 */
export function TimePicker({ initial, onDone, onCancel, onClear }: { initial: string | null; onDone: (value: string) => void; onCancel: () => void; onClear?: () => void }) {
  const start = fromTime(initial);
  const [hourText, setHourText] = useState(String(start.hour));
  const [minuteText, setMinuteText] = useState(String(start.minute).padStart(2, "0"));
  const [period, setPeriod] = useState(start.period);
  const [mode, setMode] = useState<"hour" | "minute">("hour");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const valid = Number.isInteger(hour) && hour >= 1 && hour <= 12 && minuteText !== "" && Number.isInteger(minute) && minute >= 0 && minute <= 59;
  const values = mode === "hour" ? HOURS : MINUTES;
  const current = mode === "hour" ? hour : minute;
  const handIndex = mode === "hour" ? (hour % 12) : minute / 5;
  const radius = FACE / 2 - NUMBER / 2 - 6;
  const angle = (index: number) => (index / 12) * 2 * Math.PI - Math.PI / 2;
  const at = (index: number) => ({ x: FACE / 2 + radius * Math.cos(angle(index)), y: FACE / 2 + radius * Math.sin(angle(index)) });
  const hand = Number.isInteger(handIndex) && valid ? at(handIndex) : null;

  return (
    <View style={styles.picker}>
      <Text style={styles.overline}>Select Time</Text>
      <View style={styles.readout}>
        <TextInput
          accessibilityLabel="Hour, 1 to 12"
          value={hourText}
          onFocus={() => setMode("hour")}
          onChangeText={(value) => setHourText(value.replace(/[^0-9]/g, "").slice(0, 2))}
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          style={[styles.box, mode === "hour" && styles.boxActive]}
        />
        <Text style={styles.colon}>:</Text>
        <TextInput
          accessibilityLabel="Minutes, 0 to 59"
          value={minuteText}
          onFocus={() => setMode("minute")}
          onChangeText={(value) => setMinuteText(value.replace(/[^0-9]/g, "").slice(0, 2))}
          onBlur={() => { if (minuteText.length === 1) setMinuteText(`0${minuteText}`); }}
          keyboardType="number-pad"
          maxLength={2}
          selectTextOnFocus
          style={[styles.box, mode === "minute" && styles.boxActive]}
        />
        <View style={styles.period} accessibilityRole="radiogroup">
          {(["AM", "PM"] as const).map((value) => (
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: period === value }} onPress={() => setPeriod(value)} style={[styles.periodOption, period === value && styles.selected]}>
              <Text style={[styles.periodLabel, period === value && styles.selectedLabel]}>{value}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.face} accessibilityRole="radiogroup" accessibilityLabel={mode === "hour" ? "Hour" : "Minutes"}>
        {hand ? (
          <Svg width={FACE} height={FACE} style={StyleSheet.absoluteFill} pointerEvents="none">
            <Line x1={FACE / 2} y1={FACE / 2} x2={hand.x} y2={hand.y} stroke={colors.primary} strokeWidth={1.5} />
            <Circle cx={FACE / 2} cy={FACE / 2} r={4} fill={colors.primary} />
          </Svg>
        ) : null}
        {values.map((value, index) => {
          const point = at(index);
          const selected = valid && value === current;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={mode === "hour" ? `${value} o'clock` : `${value} minutes`}
              accessibilityState={{ selected }}
              onPress={() => {
                if (mode === "hour") { setHourText(String(value)); setMode("minute"); }
                else setMinuteText(String(value).padStart(2, "0"));
              }}
              style={[styles.number, { left: point.x - NUMBER / 2, top: point.y - NUMBER / 2 }, selected && styles.selected]}
            >
              <Text style={[styles.numberLabel, selected && styles.selectedLabel]}>{mode === "hour" ? value : String(value).padStart(2, "0")}</Text>
            </Pressable>
          );
        })}
      </View>
      {!valid ? <Text style={styles.error} accessibilityRole="alert">Enter an hour from 1 to 12 and minutes from 00 to 59</Text> : null}
      <View style={styles.textButtons}>
        {onClear ? <TextButton label="Clear" onPress={onClear} /> : null}
        <View style={styles.flex} />
        <TextButton label="Cancel" onPress={onCancel} />
        <TextButton label="OK" disabled={!valid} onPress={() => onDone(toTime(hour, minute, period))} />
      </View>
    </View>
  );
}

function TextButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.textButton, pressed && styles.pressed, disabled && styles.disabled]}>
      <Text style={styles.textButtonLabel}>{label}</Text>
    </Pressable>
  );
}

export function TimeSheet({ visible, initial, onDone, onClose, onClear }: { visible: boolean; initial: string | null; onDone: (value: string) => void; onClose: () => void; onClear?: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {visible ? <TimePicker initial={initial} onDone={onDone} onCancel={onClose} onClear={onClear} /> : null}
    </BottomSheet>
  );
}

/** The unit selector on an added product. */
export function UnitSheet({ visible, product, units, selected, onSelect, onClose }: { visible: boolean; product: string; units: UnitOption[]; selected: string; onSelect: (key: string) => void; onClose: () => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Unit for {product}</Text>
      <View>
        {units.map((unit) => {
          // Out of stock can't be chosen (Jac, 8 Nov), unless the line already uses it.
          const blocked = unit.outOfStock && unit.key !== selected;
          return (
          <Pressable key={unit.key} accessibilityRole="radio" accessibilityState={{ selected: unit.key === selected, disabled: blocked }} disabled={blocked} onPress={() => onSelect(unit.key)} style={({ pressed }) => [styles.listRow, blocked && styles.blocked, pressed && styles.pressed]}>
            <Text style={styles.listLabel}>{unit.unit}</Text>
            <Text style={[styles.listMeta, unit.outOfStock && styles.outText]}>{unit.outOfStock ? "Out of stock" : `${formatMoney(unit.price)} / ${unit.unit}`}</Text>
            {unit.key === selected ? <Icon name="check" size={18} color={colors.primary} /> : <View style={styles.checkSpace} />}
          </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

/** Figma "Manage Order Sources" (administrators). Removing hides a source from new orders only. */
export function ManageSourcesSheet({ visible, sources, busy, error, onAdd, onRemove, onClose }: {
  visible: boolean;
  sources: OrderSourceOption[];
  busy: boolean;
  error: string | null;
  onAdd: (label: string, done: () => void) => void;
  onRemove: (source: OrderSourceOption) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View>
        <Text style={styles.title}>Manage Order Sources</Text>
        <Text style={styles.caption}>Add or remove channels where customer orders arrive from</Text>
      </View>
      <View style={styles.list}>
        {sources.map((source) => (
          <View key={source.id} style={styles.listRow}>
            <Text style={styles.listLabel}>{source.label}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${source.label}`} hitSlop={8} disabled={busy || sources.length <= 1} onPress={() => onRemove(source)} style={({ pressed }) => [styles.remove, pressed && styles.pressed, sources.length <= 1 && styles.disabled]}>
              <Icon name="x" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.addRow}>
        <TextInput
          value={label}
          onChangeText={setLabel}
          placeholder="e.g. WhatsApp, Walk-in, Email"
          placeholderTextColor={colors.textMuted}
          maxLength={60}
          accessibilityLabel="New order source"
          style={styles.addInput}
          returnKeyType="done"
          onSubmitEditing={() => { if (label.trim()) onAdd(label, () => setLabel("")); }}
        />
        <Button label="Add" type="brandOutline" disabled={!label.trim()} loading={busy} onPress={() => onAdd(label, () => setLabel(""))} />
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button label="Done" size="lg" onPress={onClose} />
    </BottomSheet>
  );
}

/** Manage Delivery Times (administrators): the times offered as one-tap choices on step 3. */
export function ManageTimesSheet({ visible, times, busy, error, onAdd, onRemove, onClose }: {
  visible: boolean;
  times: DeliveryTimeOption[];
  busy: boolean;
  error: string | null;
  onAdd: (start: string, end: string | null, done: () => void) => void;
  onRemove: (time: DeliveryTimeOption) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [editing, setEditing] = useState<"start" | "end" | null>(null);
  const reset = () => { setStart(null); setEnd(null); };
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View>
        <Text style={styles.title}>Manage Delivery Times</Text>
        <Text style={styles.caption}>Add or remove the delivery times offered on new orders</Text>
      </View>
      {editing ? (
        <TimePicker
          initial={editing === "start" ? start : end ?? start}
          onCancel={() => setEditing(null)}
          onClear={editing === "end" ? () => { setEnd(null); setEditing(null); } : undefined}
          onDone={(value) => { if (editing === "start") setStart(value); else setEnd(value); setEditing(null); }}
        />
      ) : (
        <>
          <View style={styles.list}>
            {times.length === 0 ? <Text style={styles.caption}>No delivery times yet. Staff can still type a time on each order.</Text> : null}
            {times.map((time) => (
              <View key={time.id} style={styles.listRow}>
                <Icon name="clock" size={18} color={colors.textSecondary} />
                <Text style={styles.listLabel}>{time.label}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${time.label}`} hitSlop={8} disabled={busy} onPress={() => onRemove(time)} style={({ pressed }) => [styles.remove, pressed && styles.pressed]}>
                  <Icon name="x" size={16} color={colors.textSecondary} />
                </Pressable>
              </View>
            ))}
          </View>
          <View style={styles.addRow}>
            <TimeBox label="Start" value={start} onPress={() => setEditing("start")} />
            <TimeBox label="End (optional)" value={end} onPress={() => setEditing("end")} />
            <Button label="Add" type="brandOutline" disabled={!start} loading={busy} onPress={() => start && onAdd(start, end, reset)} />
          </View>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <Button label="Done" size="lg" onPress={onClose} />
        </>
      )}
    </BottomSheet>
  );
}

/** A tappable time field with the clock icon (Figma "Add time"). */
export function TimeBox({ label, value, onPress, error }: { label: string; value: string | null; onPress: () => void; error?: boolean }) {
  return (
    <View style={styles.timeField}>
      <Text style={styles.timeFieldLabel}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value ? timeLabel(value) : "not set"}`} onPress={onPress} style={({ pressed }) => [styles.timeBox, value && styles.timeBoxSet, error && styles.timeBoxError, pressed && styles.pressed]}>
        <Icon name="clock" size={20} color={value ? colors.primary : colors.textSecondary} />
        <Text style={[styles.timeText, !value && styles.placeholder]}>{value ? timeLabel(value) : "Add time"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { ...text.title, color: colors.text },
  caption: { ...text.caption, color: colors.textSecondary },
  overline: { ...text.overline, color: colors.textSecondary },
  error: { ...text.caption, color: colors.danger },
  picker: { gap: 14 },
  readout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  box: { ...text.display, width: 104, minWidth: 0, height: 72, letterSpacing: 0, fontSize: 48, lineHeight: 56, textAlign: "center", borderRadius: radii.sm, backgroundColor: colors.background, color: colors.text, paddingVertical: 0 },
  boxActive: { backgroundColor: colors.primarySoft, color: colors.primary },
  colon: { ...text.display, fontSize: 40, lineHeight: 48, color: colors.text },
  period: { width: 56, borderRadius: radii.sm, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  periodOption: { height: 35, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  periodLabel: { ...text.label, color: colors.textSecondary },
  face: { width: FACE, height: FACE, alignSelf: "center", borderRadius: FACE / 2, backgroundColor: colors.background },
  number: { position: "absolute", width: NUMBER, height: NUMBER, borderRadius: NUMBER / 2, alignItems: "center", justifyContent: "center" },
  numberLabel: { ...text.body, color: colors.text },
  selected: { backgroundColor: colors.primary },
  selectedLabel: { color: colors.onBrand },
  textButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  textButton: { minHeight: 44, minWidth: 56, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: radii.sm },
  textButtonLabel: { ...text.label, color: colors.primary },
  row: { flexDirection: "row", gap: 10 },
  list: { gap: 0 },
  listRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  listLabel: { ...text.bodyStrong, flex: 1, color: colors.text },
  listMeta: { ...text.caption, color: colors.textSecondary },
  blocked: { opacity: 0.55 },
  outText: { color: colors.danger },
  checkSpace: { width: 18 },
  remove: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: radii.full, backgroundColor: colors.background },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  addRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  addInput: { ...text.body, flex: 1, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.text },
  timeField: { flex: 1, gap: 4 },
  timeFieldLabel: { ...text.overline, fontSize: 11, color: colors.textSecondary },
  timeBox: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  timeBoxSet: { borderColor: colors.primaryMuted, backgroundColor: colors.surfacePressed },
  timeBoxError: { borderColor: colors.danger },
  timeText: { ...text.body, color: colors.text },
  placeholder: { color: colors.textMuted },
});
