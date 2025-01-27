import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import styles from './RootLayout.module.css';

const RootLayout = ({ children }) => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const handleResize = (e) => setIsMobile(e.matches);
    
    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleResize);

    return () => mediaQuery.removeEventListener('change', handleResize);
  }, []);

  const rootClasses = `${styles.root} ${isMobile ? styles.mobile : ''}`.trim();

  return (
    <ErrorBoundary>
      <div className={rootClasses}>
        <main className={styles.main}>{children}</main>
      </div>
    </ErrorBoundary>
  );
};

RootLayout.propTypes = {
  children: PropTypes.node.isRequired,
};

export default RootLayout;
