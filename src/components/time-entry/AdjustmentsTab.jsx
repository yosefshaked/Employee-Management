import React, { useMemo, useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { he } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Calendar as CalendarIcon, Edit, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/supabaseClient.js';
import ConfirmPermanentDeleteModal from './ConfirmPermanentDeleteModal.jsx';
import { softDeleteWorkSessions } from '@/api/workSessions.js';

const DEFAULT_FORM = () => ({
  employeeId: '',
  date: new Date().toISOString().split('T')[0],
  type: 'credit',
  amount: '',
  notes: '',
});

function AdjustmentModal({ open, onClose, employees, onSubmit, initialData = null }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialData) {
      const isDebit = Number(initialData.total_payment || 0) < 0;
      setForm({
        employeeId: initialData.employee_id || '',
        date: initialData.date || new Date().toISOString().split('T')[0],
        type: isDebit ? 'debit' : 'credit',
        amount: String(Math.abs(Number(initialData.total_payment || 0)) || ''),
        notes: initialData.notes || '',
      });
    } else {
      setForm(DEFAULT_FORM());
    }
  }, [open, initialData]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const amountValue = parseFloat(form.amount);
    if (!form.employeeId || Number.isNaN(amountValue) || !form.date) {
      toast.error('נא למלא את כל השדות הנדרשים.');
      return;
    }
    try {
      setSubmitting(true);
      await onSubmit({
        employeeId: form.employeeId,
        date: form.date,
        type: form.type,
        amount: amountValue,
        notes: form.notes,
      });
      onClose();
    } catch (error) {
      toast.error(error.message || 'שמירת ההתאמה נכשלה.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !submitting && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-5" dir="rtl">
          <DialogHeader>
            <DialogTitle>{initialData ? 'עריכת התאמה' : 'הוספת התאמה חדשה'}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="adjustment-employee">עובד/ת</Label>
              <Select
                value={form.employeeId}
                onValueChange={(value) => handleChange('employeeId', value)}
                required
              >
                <SelectTrigger id="adjustment-employee">
                  <SelectValue placeholder="בחר/י עובד" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map(emp => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adjustment-date">תאריך</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    id="adjustment-date"
                    variant="outline"
                    className="w-full justify-start text-right font-normal bg-white"
                  >
                    <CalendarIcon className="ml-2 h-4 w-4" />
                    {format(parseISO(`${form.date}T00:00:00`), 'dd/MM/yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={parseISO(`${form.date}T00:00:00`)}
                    onSelect={(date) => {
                      if (!date) return;
                      handleChange('date', format(date, 'yyyy-MM-dd'));
                    }}
                    initialFocus
                    locale={he}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="adjustment-type">סוג התאמה</Label>
                <Select
                  value={form.type}
                  onValueChange={(value) => handleChange('type', value)}
                >
                  <SelectTrigger id="adjustment-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit">זיכוי (מוסיף תשלום)</SelectItem>
                    <SelectItem value="debit">ניכוי (מוריד תשלום)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="adjustment-amount">סכום (₪)</Label>
                <Input
                  id="adjustment-amount"
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={(event) => handleChange('amount', event.target.value)}
                  placeholder="לדוגמה: 500"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adjustment-notes">הערות / סיבת התאמה</Label>
              <Textarea
                id="adjustment-notes"
                value={form.notes}
                onChange={(event) => handleChange('notes', event.target.value)}
                rows={3}
                placeholder="לדוגמה: החזר הוצאות נסיעה"
              />
            </div>
          </div>

          <DialogFooter className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              ביטול
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'שומר...' : 'שמור'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AdjustmentsTab({ sessions = [], employees = [], onSaved, onDeleted, isLoading = false }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const employeesById = useMemo(() => {
    return new Map(employees.map(emp => [emp.id, emp]));
  }, [employees]);

  const sortedSessions = useMemo(() => {
    return [...sessions]
      .filter(item => item && item.entry_type === 'adjustment')
      .sort((a, b) => {
        const aDate = new Date(a.date || a.created_at || 0).getTime();
        const bDate = new Date(b.date || b.created_at || 0).getTime();
        if (Number.isNaN(bDate - aDate)) return 0;
        return bDate - aDate;
      });
  }, [sessions]);

  const handleCloseModal = () => {
    if (deleting) return;
    setModalOpen(false);
    setEditing(null);
  };

  const getTypeLabel = (row) => {
    if (!row) return '';
    return Number(row.total_payment || 0) < 0 ? 'ניכוי' : 'זיכוי';
  };

  const handleSubmit = async ({ employeeId, date, type, amount, notes }) => {
    const normalizedAmount = type === 'debit' ? -Math.abs(amount) : Math.abs(amount);
    const payload = {
      employee_id: employeeId,
      date,
      entry_type: 'adjustment',
      notes: notes || null,
      total_payment: normalizedAmount,
      hours: null,
      sessions_count: null,
      students_count: null,
      service_id: null,
      rate_used: normalizedAmount,
    };

    if (editing && editing.id) {
      const { error } = await supabase
        .from('WorkSessions')
        .update(payload)
        .eq('id', editing.id);
      if (error) throw new Error(error.message);
      toast.success('ההתאמה עודכנה.');
    } else {
      const { error } = await supabase
        .from('WorkSessions')
        .insert([payload]);
      if (error) throw new Error(error.message);
      toast.success('התאמה נוספה בהצלחה.');
    }

    if (typeof onSaved === 'function') {
      await onSaved();
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      setDeleting(true);
      const rows = await softDeleteWorkSessions([pendingDelete.id], supabase);
      toast.success('ההתאמה הועברה לסל האשפה.');
      if (typeof onDeleted === 'function') {
        await onDeleted([pendingDelete.id], rows);
      }
      setPendingDelete(null);
    } catch (error) {
      toast.error(error.message || 'מחיקת ההתאמה נכשלה.');
      throw error;
    } finally {
      setDeleting(false);
    }
  };

  const renderEmptyState = () => (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
      <p className="text-lg font-medium">אין התאמות להצגה</p>
      <p className="text-sm mt-1">לחצו על "הוספת התאמה" כדי ליצור רשומה חדשה.</p>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <CardTitle className="text-xl font-bold text-slate-900">התאמות שכר</CardTitle>
        <Button onClick={() => { setModalOpen(true); setEditing(null); }}>
          <Plus className="ml-2 h-4 w-4" />
          הוספת התאמה
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right w-[140px]">תאריך</TableHead>
                <TableHead className="text-right">עובד/ת</TableHead>
                <TableHead className="text-right w-[120px]">סוג</TableHead>
                <TableHead className="text-right w-[160px]">סכום (₪)</TableHead>
                <TableHead className="text-right">הערות</TableHead>
                <TableHead className="w-[140px] text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-slate-500">
                    טוען התאמות...
                  </TableCell>
                </TableRow>
              ) : sortedSessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>{renderEmptyState()}</TableCell>
                </TableRow>
              ) : (
                sortedSessions.map(row => {
                  const employee = employeesById.get(row.employee_id);
                  const amount = Math.abs(Number(row.total_payment || 0));
                  const displayAmount = Number.isFinite(amount) ? amount : 0;
                  const dateStr = row.date
                    ? format(parseISO(`${row.date}T00:00:00`), 'dd/MM/yyyy')
                    : row.created_at
                      ? format(new Date(row.created_at), 'dd/MM/yyyy')
                      : '';
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-right">{dateStr}</TableCell>
                      <TableCell className="text-right">{employee?.name || '—'}</TableCell>
                      <TableCell className="text-right">{getTypeLabel(row)}</TableCell>
                      <TableCell className={`text-right font-semibold ${row.total_payment >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                        ₪{displayAmount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right whitespace-pre-wrap">{row.notes || '—'}</TableCell>
                      <TableCell className="flex gap-2 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setEditing(row);
                            setModalOpen(true);
                          }}
                          aria-label="עריכת התאמה"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => setPendingDelete(row)}
                          aria-label="מחיקת התאמה"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <AdjustmentModal
        open={modalOpen}
        onClose={handleCloseModal}
        employees={employees}
        onSubmit={handleSubmit}
        initialData={editing}
      />

      <ConfirmPermanentDeleteModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        summaryText={pendingDelete
          ? `התאמה עבור ${employeesById.get(pendingDelete.employee_id)?.name || ''} בתאריך ${pendingDelete.date || ''}`
          : ''}
      />
    </Card>
  );
}
