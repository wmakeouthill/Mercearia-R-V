package com.example.backendspring.sale;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface SaleDeletionRepository extends JpaRepository<SaleDeletion, Long> {
}
