package com.example.backendspring.caixa;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface CaixaStatusRepository extends JpaRepository<CaixaStatus, Long> {
    Optional<CaixaStatus> findTopByOrderByIdDesc();
}
