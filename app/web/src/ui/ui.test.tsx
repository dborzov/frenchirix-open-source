import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge, Button, Counter } from './index';

afterEach(cleanup);

describe('design system', () => {
  it('Button calls onClick and not when disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={onClick} disabled>Go</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('Badge names its level', () => {
    render(<Badge level={3} />);
    expect(screen.getByRole('img', { name: 'Or' })).toBeTruthy();
  });

  it('Counter exposes its label and value', () => {
    render(<Counter icon="coin" value={47} label="Sesterces" />);
    expect(screen.getByLabelText('Sesterces: 47')).toBeTruthy();
  });
});
