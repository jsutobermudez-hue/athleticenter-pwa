// This file is to add the autoTable method to the jsPDF interface.
// The jspdf-autotable library does not ship with its own types in a way that
// module augmentation works easily with modern TypeScript.

import 'jspdf';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}
