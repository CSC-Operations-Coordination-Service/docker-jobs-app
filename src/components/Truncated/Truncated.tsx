import React from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';

/**
 * One line, cut with an ellipsis, the whole text in the tooltip: an attempt's
 * error or node id would otherwise push a table's other columns off-screen.
 */
export function Truncated({ text, maxWidth = 420 }: { text?: string; maxWidth?: number }) {
  const styles = useStyles2(() => ({
    text: css({
      display: 'inline-block',
      maxWidth,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      verticalAlign: 'bottom',
    }),
  }));

  if (!text) {
    return <>–</>;
  }

  return (
    <span className={styles.text} title={text}>
      {text}
    </span>
  );
}
