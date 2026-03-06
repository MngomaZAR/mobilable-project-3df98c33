import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  value: Date | null;
  onChange: (date: Date) => void;
  timeSlot: string;
  onTimeChange: (slot: string) => void;
};

type DayCell = {
  date: Date;
  label: number;
  disabled: boolean;
  isToday: boolean;
};

const timeSlots = ['Morning (8-11)', 'Afternoon (12-3)', 'Golden hour (4-7)', 'Evening (7-9)'];

const isSameDay = (a: Date | null, b: Date | null) =>
  !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const formatMonth = (date: Date) =>
  date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const BookingCalendar: React.FC<Props> = ({ value, onChange, timeSlot, onTimeChange }) => {
  const [currentMonth, setCurrentMonth] = useState<Date>(value ?? new Date());

  const days = useMemo<DayCell[]>(() => {
    const firstDay = new Date(Date.UTC(currentMonth.getFullYear(), currentMonth.getMonth(), 1));
    const lastDay = new Date(Date.UTC(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0));

    const leading = firstDay.getUTCDay();
    const totalDays = lastDay.getUTCDate();
    const today = new Date();

    const cells: DayCell[] = [];
    for (let i = 0; i < leading; i += 1) {
      const date = new Date(firstDay);
      date.setUTCDate(firstDay.getUTCDate() - (leading - i));
      cells.push({ date, label: date.getUTCDate(), disabled: true, isToday: false });
    }

    for (let i = 1; i <= totalDays; i += 1) {
      const date = new Date(Date.UTC(currentMonth.getFullYear(), currentMonth.getMonth(), i));
      const disabled = date < new Date(today.getTime() - 24 * 60 * 60 * 1000);
      cells.push({
        date,
        label: i,
        disabled,
        isToday: isSameDay(date, today),
      });
    }

    const trailing = 42 - cells.length;
    for (let i = 1; i <= trailing; i += 1) {
      const date = new Date(Date.UTC(currentMonth.getFullYear(), currentMonth.getMonth() + 1, i));
      cells.push({ date, label: date.getUTCDate(), disabled: true, isToday: false });
    }

    return cells;
  }, [currentMonth]);

  const selectDate = (day: DayCell) => {
    if (day.disabled) return;
    onChange(day.date);
  };

  const changeMonth = (offset: number) => {
    setCurrentMonth((prev) => new Date(Date.UTC(prev.getFullYear(), prev.getMonth() + offset, 1)));
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.navBtn} onPress={() => changeMonth(-1)}>
          <Text style={styles.navLabel}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{formatMonth(currentMonth)}</Text>
        <TouchableOpacity style={styles.navBtn} onPress={() => changeMonth(1)}>
          <Text style={styles.navLabel}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.weekdays}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
          <Text key={`${day}-${index}`} style={styles.weekday}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((day) => {
          const selected = isSameDay(value, day.date);
          return (
            <TouchableOpacity
              key={`${day.date.toISOString()}-${day.label}`}
              style={[
                styles.day,
                selected && styles.daySelected,
                day.isToday && styles.dayToday,
                day.disabled && styles.dayDisabled,
              ]}
              onPress={() => selectDate(day)}
              disabled={day.disabled}
              accessibilityLabel={`Select ${day.date.toDateString()}`}
            >
              <Text
                style={[
                  styles.dayLabel,
                  selected && styles.dayLabelSelected,
                  day.disabled && styles.dayLabelDisabled,
                ]}
              >
                {day.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.timeRow}>
        <Text style={styles.timeLabel}>Time</Text>
        <View style={styles.timeChips}>
          {timeSlots.map((slot) => {
            const active = slot === timeSlot;
            return (
              <TouchableOpacity
                key={slot}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => onTimeChange(slot)}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{slot}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    padding: 14,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  navLabel: {
    fontSize: 18,
    color: '#0f172a',
    fontWeight: '800',
  },
  weekdays: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: '#94a3b8',
    fontWeight: '700',
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  day: {
    width: `${100 / 7 - 1}%`,
    aspectRatio: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    marginBottom: 8,
  },
  daySelected: {
    backgroundColor: '#0f172a',
  },
  dayToday: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#0f172a',
  },
  dayDisabled: {
    backgroundColor: '#e5e7eb',
  },
  dayLabel: {
    fontWeight: '700',
    color: '#0f172a',
  },
  dayLabelSelected: {
    color: '#fff',
  },
  dayLabelDisabled: {
    color: '#94a3b8',
  },
  timeRow: {
    marginTop: 12,
  },
  timeLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  timeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e2e8f0',
    marginHorizontal: 4,
    marginBottom: 8,
  },
  chipActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  chipText: {
    color: '#0f172a',
    fontWeight: '700',
    fontSize: 12,
  },
  chipTextActive: {
    color: '#fff',
  },
});
