import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { collection, query, where, orderBy, onSnapshot, doc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { formatTime } from '../utils/dateUtils';
import { formatAmount } from '../utils/formatUtils';
import { useSwipeable } from 'react-swipeable';
import { showErrorNotification, showSuccessNotification } from '../utils/notifications';
import { PasswordPrompt } from '../components/PasswordPrompt';
import { Trash2 } from 'lucide-react';

interface Transaction {
  id: string;
  fromUser: string;
  toUser: string;
  amount: number;
  description: string;
  date: any;
  type: 'income' | 'expense';
  categoryId: string;
}

export const TransactionHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { categoryId } = useParams();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryTitle, setCategoryTitle] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [swipedTransactionId, setSwipedTransactionId] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (swipedTransactionId) {
        const target = e.target as HTMLElement;
        const swipedElement = document.querySelector(`[data-transaction-id="${swipedTransactionId}"]`);
        if (swipedElement && !swipedElement.contains(target)) {
          setSwipedTransactionId(null);
        }
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [swipedTransactionId]);

  const handlers = useSwipeable({
    onSwipedLeft: (eventData) => {
      const element = eventData.event.target as HTMLElement;
      const transactionElement = element.closest('[data-transaction-id]');
      if (transactionElement) {
        const transactionId = transactionElement.getAttribute('data-transaction-id');
        if (transactionId) {
          setSwipedTransactionId(transactionId === swipedTransactionId ? null : transactionId);
        }
      }
    },
    onSwipedRight: (eventData) => {
      const element = eventData.event.target as HTMLElement;
      const transactionElement = element.closest('[data-transaction-id]');
      if (transactionElement) {
        const transactionId = transactionElement.getAttribute('data-transaction-id');
        if (transactionId) {
          setSwipedTransactionId(null);
        }
      }
    },
    trackMouse: true,
    delta: 10
  });

  const handleDelete = async (isAuthenticated: boolean) => {
    if (!isAuthenticated || !selectedTransaction) {
      setShowPasswordPrompt(false);
      setSelectedTransaction(null);
      return;
    }

    try {
      const batch = writeBatch(db);
      
      // Delete the transaction
      const transactionRef = doc(db, 'transactions', selectedTransaction.id);
      batch.delete(transactionRef);

      // Find and delete the related transaction
      const relatedTransactionsQuery = query(
        collection(db, 'transactions'),
        where('relatedTransactionId', '==', selectedTransaction.id)
      );
      
      const relatedTransactionsSnapshot = await getDocs(relatedTransactionsQuery);
      relatedTransactionsSnapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      showSuccessNotification('Транзакция успешно удалена');
    } catch (error) {
      console.error('Error deleting transaction:', error);
      showErrorNotification('Ошибка при удалении транзакции');
    } finally {
      setShowPasswordPrompt(false);
      setSelectedTransaction(null);
      setSwipedTransactionId(null);
    }
  };

  const handleDeleteClick = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setShowPasswordPrompt(true);
  };

  useEffect(() => {
    if (!categoryId) return;

    const q = query(
      collection(db, 'transactions'),
      where('categoryId', '==', categoryId),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const transactionsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Transaction[];
      
      if (transactionsData.length > 0) {
        setCategoryTitle(transactionsData[0].fromUser);
      }
      
      setTransactions(transactionsData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [categoryId]);

  const formatDate = (timestamp: any) => {
    const date = new Date(timestamp.seconds * 1000);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Сегодня';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Вчера';
    } else {
      return date.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
    }
  };

  const groupTransactionsByDate = () => {
    const grouped: { [key: string]: { transactions: Transaction[], total: number } } = {};
    transactions.forEach(transaction => {
      const dateKey = formatDate(transaction.date);
      if (!grouped[dateKey]) {
        grouped[dateKey] = { transactions: [], total: 0 };
      }
      grouped[dateKey].transactions.push(transaction);
      grouped[dateKey].total += Math.abs(transaction.amount);
    });
    return grouped;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  const groupedTransactions = groupTransactionsByDate();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex items-center h-16">
            <button onClick={() => navigate(-1)} className="mr-4">
              <ArrowLeft className="w-6 h-6 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">История операций</h1>
              <p className="text-sm text-gray-500">{categoryTitle}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {Object.entries(groupedTransactions).map(([date, { transactions: dayTransactions, total }]) => (
          <div key={date} className="mb-6">
            <div className="bg-gray-100 px-4 py-2 rounded-t-lg">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-medium text-gray-600">{date}</h2>
                <span className="text-sm font-medium text-gray-900">
                  {formatAmount(total)}
                </span>
              </div>
            </div>
            <div className="bg-white rounded-b-lg shadow divide-y">
              {dayTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                  data-transaction-id={transaction.id}
                  className="relative overflow-hidden"
                  {...handlers}
                >
                  <div
                    className={`absolute inset-y-0 right-0 w-16 bg-red-500 flex items-center justify-center transition-opacity duration-200 ${
                      swipedTransactionId === transaction.id ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    <button
                      onClick={() => handleDeleteClick(transaction)}
                      className="w-full h-full flex items-center justify-center"
                    >
                      <Trash2 className="w-5 h-5 text-white" />
                    </button>
                  </div>
                  <div
                    className={`bg-white p-4 transition-transform ${
                      swipedTransactionId === transaction.id ? '-translate-x-16' : 'translate-x-0'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex items-start space-x-3">
                        <div className="mt-1">
                          {transaction.type === 'income' ? (
                            <ArrowUpRight className="w-5 h-5 text-emerald-500" />
                          ) : (
                            <ArrowDownRight className="w-5 h-5 text-red-500" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{transaction.fromUser}</div>
                          <div className="text-sm text-gray-500">{transaction.toUser}</div>
                          <div className="text-xs text-gray-400 mt-1">
                            {formatTime(transaction.date)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-medium ${
                          transaction.type === 'income' ? 'text-emerald-600' : 'text-red-600'
                        }`}>
                          {transaction.type === 'income' ? '+' : '-'} {formatAmount(transaction.amount)}
                        </div>
                        <div className="text-sm text-gray-500 mt-1">
                          {transaction.description}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {transactions.length === 0 && (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <ArrowDownRight className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">История операций пуста</h3>
            <p className="text-gray-500">Здесь будут отображаться все операции</p>
          </div>
        )}
      </div>
      
      {showPasswordPrompt && (
        <PasswordPrompt
          isOpen={showPasswordPrompt}
          onClose={() => {
            setShowPasswordPrompt(false);
            setSelectedTransaction(null);
          }}
          onSuccess={() => handleDelete(true)}
        />
      )}
    </div>
  );
};