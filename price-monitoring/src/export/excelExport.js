/**
 * Модуль экспорта данных в Excel
 */

import ExcelJS from 'exceljs';

/**
 * Генерирует Excel файл с новыми товарами
 * @param {Array} newItems - Массив новых товаров [{name, price, url}]
 * @returns {Promise<Buffer>} Buffer с Excel файлом
 */
export async function generateNewItemsExcel(newItems) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Новые товары');
  
  // Определяем колонки
  worksheet.columns = [
    { header: 'Наименование', key: 'name', width: 50 },
    { header: 'Цена', key: 'price', width: 15 },
    { header: 'Ссылка', key: 'url', width: 80 }
  ];
  
  // Форматируем заголовки (bold)
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // Добавляем данные
  newItems.forEach(item => {
    worksheet.addRow({
      name: item.name,
      price: item.price,
      url: item.url
    });
  });
  
  // Форматируем колонку с ценами
  worksheet.getColumn('price').numFmt = '#,##0 ₽';
  worksheet.getColumn('price').alignment = { horizontal: 'right' };
  
  // Делаем ссылки кликабельными
  worksheet.getColumn('url').eachCell((cell, rowNumber) => {
    if (rowNumber > 1) { // Пропускаем заголовок
      cell.value = {
        text: cell.value,
        hyperlink: cell.value
      };
      cell.font = { color: { argb: 'FF0000FF' }, underline: true };
    }
  });
  
  // Генерируем Buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}
