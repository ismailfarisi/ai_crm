import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable } from './data-table';
import { ColumnDef } from '@tanstack/react-table';

interface User {
  id: string;
  name: string;
  email: string;
}

const columns: ColumnDef<User, any>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
];

const data: User[] = [
  { id: '1', name: 'Alice Smith', email: 'alice@example.com' },
  { id: '2', name: 'Bob Jones', email: 'bob@example.com' },
];

describe('DataTable', () => {
  it('renders table headers and data correctly in table view', () => {
    render(<DataTable columns={columns} data={data} defaultViewMode="table" />);
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('renders custom empty state when data is empty', () => {
    render(<DataTable columns={columns} data={[]} emptyTitle="No users found" />);
    expect(screen.getByText('No users found')).toBeInTheDocument();
  });
});
